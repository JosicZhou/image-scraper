document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'https://web-scraper-backend-l4a9.onrender.com'; // Your backend URL

    const urlInput = document.getElementById('url-input');
    const scrapeBtn = document.getElementById('scrape-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const imageGallery = document.getElementById('image-gallery');
    const imageCount = document.getElementById('image-count');
    const errorMessage = document.getElementById('error-message');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const downloadSelectedBtn = document.getElementById('download-selected-btn');
    const deepScrapeCheckbox = document.getElementById('deep-scrape-checkbox');
    const concurrencyInput = document.getElementById('concurrency-input');

    let allImages = [];
    let observer;

    scrapeBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a valid URL.');
            return;
        }

        clearUI();
        loadingIndicator.style.display = 'block';

        try {
            const mode = deepScrapeCheckbox.checked ? 'selenium' : 'requests';
            const response = await fetch(`${API_URL}/scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, mode })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            allImages = data.images;
            imageCount.textContent = `Found ${allImages.length} images.`;

            if (allImages.length > 0) {
                document.querySelector('.image-info').style.display = 'flex';
                setupIntersectionObserver();
                renderImages();
            } else {
                showError('No images found on this page.');
            }

        } catch (error) {
            console.error('Scrape error:', error);
            showError(`Failed to scrape images. ${error.message}`);
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });

    function clearUI() {
        imageGallery.innerHTML = '';
        errorMessage.style.display = 'none';
        imageCount.textContent = 'Found 0 images.';
        document.querySelector('.image-info').style.display = 'none';
        allImages = [];
        if (observer) {
            observer.disconnect();
        }
    }
    
    function setupIntersectionObserver() {
        if (observer) {
            observer.disconnect();
        }
        const concurrency = parseInt(concurrencyInput.value, 10) || 5;
        const limit = pLimit(concurrency);

        observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    const imageUrl = card.dataset.src;
                    const proxyUrl = `${API_URL}/proxy?url=${encodeURIComponent(imageUrl)}`;
                    
                    limit(() => loadImage(card, proxyUrl));
                    obs.unobserve(card);
                }
            });
        }, {
            rootMargin: '0px 0px 200px 0px', // Pre-load images 200px below the viewport
            threshold: 0.01
        });
    }

    async function loadImage(card, proxyUrl) {
        const placeholder = card.querySelector('.image-placeholder');
        try {
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error('Proxy fetch failed');

            const blob = await response.blob();
            const objectURL = URL.createObjectURL(blob);
            
            const img = new Image();
            img.src = objectURL;
            img.alt = card.dataset.alt;
            img.onload = () => {
                placeholder.replaceWith(img);
            };
            img.onerror = () => {
                placeholder.innerHTML = 'Load Failed';
            }
        } catch (e) {
             placeholder.innerHTML = 'Load Failed';
        }
    }


    function renderImages() {
        allImages.forEach(image => {
            const card = document.createElement('div');
            card.className = 'image-card';
            card.dataset.src = image.src;
            card.dataset.alt = image.alt || '';

            card.innerHTML = `
                <div class="image-placeholder">
                    <div class="placeholder-spinner"></div>
                </div>
                <p class="alt-text" title="${image.alt || 'No alt text'}">${image.alt || 'No alt text'}</p>
                <div class="actions">
                    <input type="checkbox" class="select-checkbox">
                    <a href="${API_URL}/proxy?url=${encodeURIComponent(image.src)}" download>
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            `;
            imageGallery.appendChild(card);
            observer.observe(card);
        });
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }

    selectAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.select-checkbox').forEach(cb => cb.checked = true);
    });

    deselectAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.select-checkbox').forEach(cb => cb.checked = false);
    });

    downloadSelectedBtn.addEventListener('click', () => {
        const selectedImages = [];
        document.querySelectorAll('.image-card').forEach(card => {
            if (card.querySelector('.select-checkbox').checked) {
                selectedImages.push(card.dataset.src);
            }
        });

        if (selectedImages.length === 0) {
            alert('No images selected for download.');
            return;
        }

        selectedImages.forEach((src, index) => {
            // Stagger downloads slightly to avoid overwhelming the browser/server
            setTimeout(() => {
                const link = document.createElement('a');
                link.href = `${API_URL}/proxy?url=${encodeURIComponent(src)}`;
                
                // Try to get a filename
                let filename = '';
                try {
                    const urlPath = new URL(src).pathname;
                    filename = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                } catch(e) {
                    // fallback for invalid urls
                    filename = `image_${index}.jpg`;
                }
                
                link.download = filename || `image_${index}.jpg`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }, index * 200);
        });
    });
});
