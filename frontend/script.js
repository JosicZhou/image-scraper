document.addEventListener('DOMContentLoaded', () => {
    const scrapeBtn = document.getElementById('scrape-btn');
    const urlInput = document.getElementById('url-input');
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
    let currentIndex = 0;
    const batchSize = 50;

    scrapeBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            alert('Please enter a URL.');
            return;
        }

        imageGallery.innerHTML = '';
        allImages = [];
        currentIndex = 0;
        loadMoreContainer.style.display = 'none';
        
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
        const nextIndex = Math.min(currentIndex + batchSize, allImages.length);
        
        for (let i = currentIndex; i < nextIndex; i++) {
            const image = allImages[i];
            const imageCard = createImageCard(image, i);
            fragment.appendChild(imageCard);
        }

        imageGallery.appendChild(fragment);
        currentIndex = nextIndex;

        if (currentIndex < allImages.length) {
            loadMoreContainer.style.display = 'block';
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }

    function createImageCard(image, index) {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.dataset.index = index;
        card.dataset.imageUrl = image.src;
        card.dataset.altText = image.alt;

        const proxyUrl = `${API_URL}/proxy?url=${encodeURIComponent(image.src)}`;

        card.innerHTML = `
            <img src="${proxyUrl}" alt="${image.alt}" loading="lazy" 
                 onerror="this.onerror=null; this.src='https://via.placeholder.com/200x150?text=Image+Failed';">
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
                src: card.dataset.imageUrl,
                alt: card.dataset.altText
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
