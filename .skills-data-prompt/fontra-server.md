# Fontra Server Management Skill

This skill provides instructions for managing the Fontra development server — a browser-based font editor.

## Prerequisites

- Python >= 3.10
- Install dependencies: `pip install -e .`
- Activate virtual environment if using one: `venv\Scripts\activate` (Windows)

## Start the Server

### Basic Usage

```bash
fontra filesystem <path-to-font-directory>
```

### Launch with Browser Auto-Open

```bash
fontra --launch filesystem test-py/data/mutatorsans
```

### With Custom Port

```bash
fontra --http-port 8080 filesystem test-py/data/mutatorsans
```

### Development Mode (with hot-reload)

```bash
fontra --dev filesystem test-py/data/mutatorsans
```

### Alternative: Using run_server.py

```bash
python run_server.py --launch filesystem test-py/data/mutatorsans
```

## Supported Font Backends

The `filesystem` project manager supports these font formats:

| Extension | Backend Type |
|-----------|-------------|
| `.designspace` | designspace |
| `.ufo` | ufo |
| `.ttf` | ttf |
| `.otf` | otf |
| `.ttx` | ttx |
| `.woff` | woff |
| `.woff2` | woff2 |
| `.fontra` | fontra |
| `.yaml` | yaml (workflow) |

## Test Font Data

Test fonts are located in `test-py/data/`:

- **mutatorsans/** — Main test font with multiple formats (TTF, OTF, UFO, designspace, fontra)
- **noto/** — Noto font samples
- **sourcesans/** — Source Sans samples
- **avar2/** — Avar2 test data
- **right-to-left-kerning-ufo/** — RTL kerning test

## Server Configuration

| Flag | Description | Default |
|------|-------------|---------|
| `--host` | Host address | `localhost` |
| `--http-port` | HTTP port (auto-finds free port if omitted) | 8000 |
| `--launch` | Launch browser after start | false |
| `--dev` | Enable development mode (hot-reload) | false |
| `--content-root` | Custom content root path | - |
| `-V, --version` | Show version number | - |

## Server URLs

- Main editor: `http://localhost:8000/`
- Font overview: `http://localhost:8000/fontoverview`
- Font info: `http://localhost:8000/fontinfo`
- Application settings: `http://localhost:8000/applicationsettings`

## Stop the Server

```powershell
# Windows: Find and kill process on port 8000
$connection = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess
if ($connection) { Stop-Process -Id $connection -Force }
```

```bash
# Linux/macOS
lsof -ti:8000 | xargs kill -9
```

## Verify Server Status

```powershell
# Windows: Check if port 8000 is in use
netstat -ano | Select-String ":8000"
```

```bash
# Linux/macOS
lsof -i :8000
```

## Notes

- If `--http-port` is not specified, Fontra auto-detects a free port starting at 8000
- The server generates a secret `versionToken` for each session
- In `--dev` mode, `npm run bundle-watch` runs automatically for JS hot-reloading
- Font files are served from the directory specified after the `filesystem` argument
- Multiple font files in the directory will be listed in the browser interface
