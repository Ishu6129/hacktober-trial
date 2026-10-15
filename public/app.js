const uploadForm = document.getElementById('uploadForm');
const folderSelect = document.getElementById('folderSelect');
const folderGallery = document.getElementById('folderGallery');
const statusMessage = document.getElementById('statusMessage');
const printBtn = document.getElementById('printBtn');
const dateInput = document.getElementById('imageDate');

const today = new Date().toISOString().slice(0, 10);
dateInput.value = today;

async function loadFolders() {
  try {
    const response = await fetch('/api/folders');
    const result = await response.json();

    if (!result.ok || !Array.isArray(result.folders)) {
      throw new Error('Unable to load folders right now.');
    }

    const folders = result.folders;
    folderSelect.innerHTML = '';

    if (!folders.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No folders yet';
      folderSelect.appendChild(option);
      folderGallery.innerHTML = '<div class="empty-state">No images have been uploaded yet.</div>';
      return;
    }

    folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.name;
      option.textContent = `${folder.name} (${folder.fileCount})`;
      folderSelect.appendChild(option);
    });

    if (!folderSelect.value) {
      folderSelect.value = folders[0].name;
    }

    renderSelectedFolder();
  } catch (error) {
    statusMessage.textContent = error.message;
  }
}

async function renderSelectedFolder() {
  const folderName = folderSelect.value;
  if (!folderName) {
    folderGallery.innerHTML = '<div class="empty-state">Select a folder to view images.</div>';
    return;
  }

  try {
    const response = await fetch(`/api/folder/${encodeURIComponent(folderName)}`);
    const result = await response.json();

    if (!result.ok || !Array.isArray(result.files)) {
      throw new Error('Unable to load the selected folder.');
    }

    if (!result.files.length) {
      folderGallery.innerHTML = '<div class="empty-state">This folder does not contain any images yet.</div>';
      return;
    }

    folderGallery.innerHTML = result.files
      .map(
        (file) => `
          <figure class="gallery-item">
            <img src="${file.url}" alt="${file.name}" />
            <figcaption>${file.name}</figcaption>
          </figure>
        `,
      )
      .join('');
  } catch (error) {
    statusMessage.textContent = error.message;
  }
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(uploadForm);

  try {
    statusMessage.textContent = 'Uploading images...';
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'Upload failed.');
    }

    statusMessage.textContent = `Uploaded ${result.total} image(s) to ${result.folder}.`;
    uploadForm.reset();
    dateInput.value = today;
    await loadFolders();

    if (result.folder) {
      folderSelect.value = result.folder;
      renderSelectedFolder();
    }
  } catch (error) {
    statusMessage.textContent = error.message;
  }
});

folderSelect.addEventListener('change', renderSelectedFolder);

printBtn.addEventListener('click', () => {
  const folderName = folderSelect.value;

  if (!folderName) {
    statusMessage.textContent = 'Please select a folder before printing.';
    return;
  }

  if (!folderGallery.querySelector('img')) {
    statusMessage.textContent = 'That folder does not contain images to print.';
    return;
  }

  window.print();
});

loadFolders();
