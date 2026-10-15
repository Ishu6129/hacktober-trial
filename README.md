# Hacktober Trial

A lightweight image upload manager that stores files under date-based folders and lets you print the selected folder's images as a PDF using the browser print dialog.

## Features

- Upload multiple images at once
- Organize images by date or custom folder name
- Browse uploaded folders in the browser
- Print the selected folder as a PDF from the browser

## Run locally

```bash
node server.js
```

Then open http://localhost:3000 in the browser.

## Notes

- uploaded images are saved in the `uploads/` folder
- the selected folder view is printable to PDF through the browser print option
