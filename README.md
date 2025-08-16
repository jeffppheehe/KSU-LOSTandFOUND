# Campus Lost & Found — Thesis Starter

Tech Stack:
- Node.js + Express (backend & static hosting)
- SQLite (database)
- Multer (file uploads)
- Vanilla HTML/CSS/JS (frontend)

## Quick Start

1) Install Node.js (v18+).  
2) Extract this project, open a terminal in the folder, then run:
```bash
npm install
npm start
```
3) Open http://localhost:3000 in your browser.

**Default Admin**:  
Email: `admin@example.com`  
Password: `admin123`

## Notes
- Item photos and proof images are saved in `/uploads`.
- Database file is `lostfound.db` (auto-created).
- This is a minimal starter; add proper authentication (JWT/sessions), email verification, and validation for production.
- Matching is heuristic — tweak weights in `server.js` (`simpleMatchScore`).
