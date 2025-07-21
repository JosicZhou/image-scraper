    document.addEventListener('DOMContentLoaded', () => {
        const scrapeBtn = document.getElementById('scrape-btn');
        const urlInput = document.getElementById('url-input');
        const concurrencyInput = document.getElementById('concurrency-input');
        const imageCountEl = document.getElementById('image-count');
        const imageGallery = document.getElementById('image-gallery');
        const loadMoreContainer = document.getElementById('load-more-container');
        const loadMoreBtn = document.getElementById('load-more-btn');
        const stopBtn = document.getElementById('stop-btn');
    
        const selectAllBtn = document.getElementById('select-all-btn');
        const deselectAllBtn = document.getElementById('deselect-all-btn');
        const downloadSelectedBtn = document.getElementById('download-selected-btn');
        const deleteSelectedBtn = document.getElementById('delete-selected-btn');
        const deepScrapeCheckbox = document.getElementById('deep-scrape-checkbox');
    
        const API_URL = 'https://image-scraper-service.onrender.com';
        let allImages = [];
        let observer;
    
        // Use p-limit library, which is loaded in index.html
        const pLimit = window.pLimit;
        let limit = pLimit(parseInt(concurrencyInput.value, 10));
    
        concurrencyInput.addEventListener('change', () => {
            const newConcurrency = parseInt(concurrencyInput.value, 10);
            if (newConcurrency > 0) {
                limit = pLimit(newConcurrency);
                console.log(`Concurrency set to ${newConcurrency}`);
            }
        });
    
        scrapeBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                alert('Please enter a URL.');
                return;
            }
    
            imageGallery.innerHTML = '';
            allImages = [];
            if (observer) {
                observer.disconnect();
            }
            
            try {
                scrapeBtn.textContent = 'Scraping...';
                scrapeBtn.disabled = true;
    
                const scrapeMode = deepScrapeCheckbox.checked ? 'deep' : 'fast';
    
                const response = await fetch(`${API_URL}/scrape`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, mode: scrapeMode }),
                });
    
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({'error': 'An unknown error occurred during scrape.'}));
                    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                }
    
                allImages = await response.json();
                imageCountEl.textContent = `Found ${allImages.length} images.`;
                renderImages();
    
            } catch (error) {
                alert(`Error scraping images: ${error.message}`);
                imageCountEl.textContent = 'Failed to scrape images.';
            } finally {
                scrapeBtn.textContent = 'Scrape Images';
                scrapeBtn.disabled = false;
            }
        });
    
        function renderImages() {
            const fragment = document.createDocumentFragment();
            for (const image of allImages) {
                const imageCard = createImageCard(image);
                fragment.appendChild(imageCard);
            }
            imageGallery.appendChild(fragment);
            setupIntersectionObserver();
        }
    
        function createImageCard(image) {
            const card = document.createElement('div');
            card.className = 'image-card';
            card.dataset.src = image.src; // Store real src here
            card.dataset.alt = image.alt;
    
            card.innerHTML = `
                <div class="image-placeholder"></div>
                <p class="alt-text" title="${image.alt}">${image.alt || 'No alt text'}</p>
                <div class="actions">
                    <button class="download-btn">Download</button>
                    <button class="delete-btn">Delete</button>
                </div>
                <input type="checkbox" class="checkbox">
            `;
    
            card.querySelector('.download-btn').addEventListener('click', (event) => downloadSingleImage(image, event));
            card.querySelector('.delete-btn').addEventListener('click', () => card.remove());
            
            return card;
        }
    
        function setupIntersectionObserver() {
            const cards = document.querySelectorAll('.image-card');
            observer = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const card = entry.target;
                        // Queue the image load using p-limit
                        limit(() => loadImage(card));
                        observer.unobserve(card);
                    }
                });
            }, {
                rootMargin: '200px', // Load images 200px before they enter the viewport
            });
    
            cards.forEach(card => observer.observe(card));
        }
    
        async function loadImage(card) {
            const src = card.dataset.src;
            const alt = card.dataset.alt;
            const placeholder = card.querySelector('.image-placeholder');
            
            if (!src || !placeholder) return;
    
            try {
                const proxyUrl = `${API_URL}/proxy?url=${encodeURIComponent(src)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                
                const blob = await response.blob();
                const img = document.createElement('img');
                img.src = URL.createObjectURL(blob);
                img.alt = alt;
                img.onload = () => URL.revokeObjectURL(img.src); // Clean up memory
                
                placeholder.replaceWith(img);
    
            } catch (error) {
                console.error(`Error loading image ${src}:`, error);
                placeholder.textContent = 'Failed';
                placeholder.style.color = 'red';
            }
        }
    
        async function downloadSingleImage(image, event) {
            const button = event.target;
            const originalText = button.textContent;
            try {
                button.textContent = 'Downloading...';
                button.disabled = true;
    
                const response = await fetch(`${API_URL}/download-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: image.src, alt: image.alt }),
                });
    
                if (!response.ok) {
                    const errorResult = await response.json().catch(() => ({ error: 'An unknown error occurred' }));
                    throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
                }
                
                const disposition = response.headers.get('Content-Disposition');
                let filename = "download.jpg";
                if (disposition && disposition.indexOf('attachment') !== -1) {
                    const filenameRegex = /filename[^;=\n]*=(['"]?)(.*?)\1(?:;|$)/;
                    const matches = filenameRegex.exec(disposition);
                    if (matches != null && matches[2]) { 
                      filename = matches[2];
                    }
                }
    
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
    
            } catch (error) {
                alert(`Error downloading image: ${error.message}`);
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
    
        loadMoreBtn.addEventListener('click', renderImages);
    
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.image-card .checkbox').forEach(cb => cb.checked = true);
        });
    
        deselectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.image-card .checkbox').forEach(cb => cb.checked = false);
        });
    
        deleteSelectedBtn.addEventListener('click', () => {
            document.querySelectorAll('.image-card .checkbox:checked').forEach(cb => {
                cb.closest('.image-card').remove();
            });
        });
    
        downloadSelectedBtn.addEventListener('click', async () => {
            const selectedImages = [];
            document.querySelectorAll('.image-card .checkbox:checked').forEach(cb => {
                const card = cb.closest('.image-card');
                selectedImages.push({
                    src: card.dataset.src,
                    alt: card.dataset.alt
                });
            });
    
            if (selectedImages.length === 0) {
                alert('No images selected.');
                return;
            }
    
            const button = downloadSelectedBtn;
            const originalText = button.textContent;
            try {
                button.textContent = `Downloading (${selectedImages.length})...`;
                button.disabled = true;
    
                const response = await fetch(`${API_URL}/download-selected`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ images: selectedImages }),
                });
    
                if (!response.ok) {
                    const errorResult = await response.json().catch(() => ({ error: 'An unknown error occurred' }));
                    throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
                }
    
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'images.zip';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
    
            } catch (error) {
                alert(`Error downloading selected images: ${error.message}`);
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        });
    });
