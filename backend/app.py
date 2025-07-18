from flask import Flask, request, jsonify, send_file
from flask_cors import CORS, cross_origin
import requests
from bs4 import BeautifulSoup
import re
from urllib.parse import urljoin, urlparse
from io import BytesIO
import zipfile
from concurrent.futures import ThreadPoolExecutor
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import time

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

def clean_fandom_url(url):
    return re.sub(r'/revision/latest/scale-to-width-down/\d+', '', url)

def scrape_images(url):
    try:
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        images = []
        for img in soup.find_all('img'):
            src = img.get('src')
            if src:
                full_url = urljoin(url, src)
                if 'static.wikia.nocookie.net' in full_url:
                    full_url = clean_fandom_url(full_url)
                images.append({
                    "src": full_url,
                    "alt": img.get('alt', 'No alt text')
                })
        return images
    except requests.RequestException as e:
        print(f"Error fetching URL: {e}")
        return []

def scrape_deep(url):
    """
    Scraping method using Selenium. Now simplified for Docker.
    """
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    
    # Selenium Manager will automatically find Chrome and ChromeDriver in the Docker container
    service = Service()
    driver = webdriver.Chrome(service=service, options=chrome_options)

    images = []
    try:
        driver.get(url)
        last_height = driver.execute_script("return document.body.scrollHeight")
        for _ in range(5): 
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height
        
        page_source = driver.page_source
        soup = BeautifulSoup(page_source, 'html.parser')

        for img in soup.find_all('img'):
            src = img.get('src')
            if src:
                full_url = urljoin(url, src)
                if 'static.wikia.nocookie.net' in full_url:
                    full_url = clean_fandom_url(full_url)
                images.append({
                    "src": full_url,
                    "alt": img.get('alt', 'No alt text')
                })
    finally:
        driver.quit()

    return images


@app.route('/scrape', methods=['POST'])
@cross_origin()
def scrape():
    data = request.get_json()
    url = data.get('url')
    mode = data.get('mode', 'fast')

    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        if mode == 'deep':
            print("Using deep scraping mode.")
            images = scrape_deep(url)
        else:
            print("Using fast scraping mode.")
            images = scrape_images(url)
        
        cleaned_images = [img for img in images if img.get('alt', '').strip()]
        return jsonify(cleaned_images)
    except Exception as e:
        print(f"An error occurred during scraping: {e}")
        return jsonify({"error": str(e), "type": "ScrapingError"}), 500

@app.route('/proxy')
def proxy():
    url = request.args.get('url')
    if not url:
        return "URL parameter is required", 400
    try:
        response = requests.get(url, stream=True, headers={'User-Agent': 'Mozilla/5.0', 'Referer': url})
        response.raise_for_status()
        content = BytesIO(response.content)
        return send_file(content, mimetype=response.headers.get('Content-Type', 'image/jpeg'))
    except requests.RequestException as e:
        return f"Failed to fetch image: {e}", 500

def sanitize_filename(name):
    name = re.sub(r'[\r\n]', '', name)
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    name = name.replace('_', ' ')
    return name.strip()[:200]

def download_image(img_data):
    url = img_data.get("src")
    alt = img_data.get("alt", "image")
    try:
        response = requests.get(url, stream=True, headers={'User-Agent': 'Mozilla/5.0', 'Referer': url})
        response.raise_for_status()
        filename_alt = sanitize_filename(alt)
        url_path = urlparse(url).path
        ext = os.path.splitext(url_path)[1]
        if not ext:
            content_type = response.headers.get('Content-Type', '')
            ext = '.jpg' if 'jpeg' in content_type or 'jpg' in content_type else '.png' if 'png' in content_type else '.jpg'
        filename = f"{filename_alt}{ext}"
        return filename, response.content
    except Exception as e:
        print(f"Failed to download {url}: {e}")
        return None, None

@app.route('/download-selected', methods=['POST'])
@cross_origin()
def download_selected():
    data = request.get_json()
    images_to_download = data.get('images', [])

    if not images_to_download:
        return "No images selected for download.", 400

    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, 'a', zipfile.ZIP_DEFLATED, False) as zip_file:
        downloaded_filenames = set()
        with ThreadPoolExecutor(max_workers=2) as executor: # Reduced from 10 to 2
            future_to_img = {executor.submit(download_image, img): img for img in images_to_download}
            for future in future_to_img:
                filename, content = future.result()
                if filename and content and filename not in downloaded_filenames:
                    zip_file.writestr(filename, content)
                    downloaded_filenames.add(filename)
    zip_buffer.seek(0)
    return send_file(zip_buffer, mimetype='application/zip', as_attachment=True, download_name='images.zip')

@app.route('/')
def health_check():
    return "Backend is running."

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True)
