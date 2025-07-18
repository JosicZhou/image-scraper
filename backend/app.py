import os
import re
import requests
import io
import zipfile
import concurrent.futures
import threading
import time
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS, cross_origin
from bs4 import BeautifulSoup, Tag
from urllib.parse import urljoin, urlparse

# Selenium imports for deep scraping
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

app = Flask(__name__)

# Allow requests from the Netlify frontend
CORS(app, origins=["https://bright-begonia-2ef8db.netlify.app"])

def sanitize_filename(filename):
    """
    Sanitizes a string to be a valid filename.
    """
    # Replace underscores with spaces for better readability
    sanitized = filename.replace('_', ' ')
    # Remove characters that are invalid in Windows filenames
    sanitized = re.sub(r'[\\/*?:"<>|]',"", sanitized)
    # Limit length to prevent issues with file systems
    return sanitized[:100]

def clean_fandom_url(url):
    """
    Removes Fandom/Wikia image resizing parameters from a URL to get the full-resolution image.
    e.g. .../image.png/revision/latest/scale-to-width-down/150 -> .../image.png
    """
    if 'wikia.nocookie.net' in url:
        # Find the image file extension and cut off any path info after it.
        match = re.search(r'\.(png|jpg|jpeg|gif|webp)', url, re.IGNORECASE)
        if match:
            end_pos = match.end()
            base_url = url[:end_pos]
            # Keep the original query string if it exists (e.g., ?cb=...)
            query_match = re.search(r'\?.*', url)
            query_string = query_match.group(0) if query_match else ''
            return base_url + query_string
    return url

def scrape_fast(url):
    """
    Original fast scraping method using requests.
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        # Re-raise a custom exception to be caught by the main route
        raise ValueError(f"Request failed: {str(e)}")

    soup = BeautifulSoup(response.content, 'html.parser')
    images = []
    for img in soup.find_all('img'):
        if isinstance(img, Tag):
            src = img.get('data-src') or img.get('src')
            alt = img.get('alt')

            if src and alt:
                src = urljoin(url, str(src))
                src = clean_fandom_url(src)
                images.append({'src': src, 'alt': str(alt)})
    return images


def scrape_deep(url):
    """
    New deep scraping method using Selenium to handle dynamic content.
    """
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    # For Render deployment, chromedriver is often in a specific path
    # We will let Selenium Manager handle this, which is the default for Service()
    service = Service()
    driver = webdriver.Chrome(service=service, options=chrome_options)

    images = []
    try:
        driver.get(url)
        
        last_height = driver.execute_script("return document.body.scrollHeight")
        for _ in range(5): # Limit scrolls to prevent infinite loops
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)
            new_height = driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height
        
        time.sleep(2) # Final wait
        page_source = driver.page_source
        soup = BeautifulSoup(page_source, 'html.parser')

        for img in soup.find_all('img'):
            src = img.get('src')
            alt = img.get('alt')
            if src and alt:
                src = urljoin(url, str(src))
                images.append({'src': src, 'alt': str(alt)})
    finally:
        driver.quit()
        
    return images


@app.route('/scrape', methods=['POST'])
@cross_origin()
def scrape():
    data = request.get_json()
    url = data.get('url')
    mode = data.get('mode', 'fast') # Default to fast mode

    if not url:
        return jsonify({"error": "URL is required"}), 400

    try:
        if mode == 'deep':
            print("Using deep scraping mode.")
            images = scrape_deep(url)
        else:
            print("Using fast scraping mode.")
            images = scrape_fast(url)
        
        # Filter out images with no alt text from the results
        images = [img for img in images if img.get('alt', '').strip()]
        
        return jsonify(images)
    except Exception as e:
        print(f"An error occurred during scraping: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/proxy')
@cross_origin()
def proxy_image():
    image_url = request.args.get('url')
    if not image_url:
        return jsonify({"error": "Image URL parameter is required"}), 400
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        parsed_url = urlparse(image_url)
        headers['Referer'] = f"{parsed_url.scheme}://{parsed_url.netloc}/"
        
        response = requests.get(image_url, headers=headers, stream=True, timeout=20)
        response.raise_for_status()
        
        return send_file(
            io.BytesIO(response.content),
            mimetype=response.headers.get('content-type', 'image/jpeg')
        )
            
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500


@app.route('/download-image', methods=['POST'])
@cross_origin()
def download_image():
    data = request.get_json()
    image_url = data.get('url')
    alt_text = data.get('alt', 'no_alt_name')

    if not image_url:
        return jsonify({"error": "Image URL is required"}), 400

    try:
        response = requests.get(image_url, stream=True, timeout=20)
        response.raise_for_status()

        content_type = response.headers.get('content-type')
        extension = '.jpg'
        if content_type:
            if 'jpeg' in content_type:
                extension = '.jpg'
            elif 'png' in content_type:
                extension = '.png'
            elif 'gif' in content_type:
                extension = '.gif'
            elif 'svg' in content_type:
                extension = '.svg'

        filename = sanitize_filename(alt_text) + extension
        
        return send_file(
            io.BytesIO(response.content),
            mimetype=response.headers.get('content-type', 'image/jpeg'),
            as_attachment=True,
            download_name=filename
        )

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500


@app.route('/download-selected', methods=['POST'])
@cross_origin()
def download_selected():
    data = request.get_json()
    images_to_download = data.get('images', [])

    if not images_to_download:
        return jsonify({"error": "Image list is required"}), 400

    seen_filenames = set()
    lock = threading.Lock()

    def download_and_prepare(image_info):
        image_url = image_info.get('src')
        alt_text = image_info.get('alt', 'no_alt_name')

        if not image_url:
            return None

        try:
            response = requests.get(image_url, stream=True, timeout=20)
            response.raise_for_status()

            content_type = response.headers.get('content-type')
            extension = '.jpg'
            if content_type:
                if 'jpeg' in content_type:
                    extension = '.jpg'
                elif 'png' in content_type:
                    extension = '.png'
                elif 'gif' in content_type:
                    extension = '.gif'
                elif 'svg' in content_type:
                    extension = '.svg'
            
            filename = f"{sanitize_filename(alt_text)}{extension}"
            
            with lock:
                if filename in seen_filenames:
                    print(f"Skipping duplicate file: {filename}")
                    return None
                seen_filenames.add(filename)

            return (filename, response.content)
        
        except requests.exceptions.RequestException as e:
            print(f"Failed to download {image_url}: {e}")
            return None

    memory_file = io.BytesIO()
    
    with zipfile.ZipFile(memory_file, 'w') as zf:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_image = {executor.submit(download_and_prepare, img): img for img in images_to_download}
            
            for future in concurrent.futures.as_completed(future_to_image):
                result = future.result()
                if result:
                    filename, content = result
                    zf.writestr(filename, content)

    memory_file.seek(0)
    
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='images.zip'
    )

if __name__ == '__main__':
    # This block is for local development only.
    # When deployed on Render, it uses the 'web' command from the Procfile.
    app.run(host='0.0.0.0', debug=True, port=5000)
