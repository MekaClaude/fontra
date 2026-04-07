# Fontra Server Management Skill

## Description
Skill for managing the Fontra server (start, stop, status check).

## Commands

### Start Fontra Server
```bash
cd D:\DEVWEB\MINIMAX AGENT\fontra\fontra && python run_server.py
```
Start the Fontra server using the run_server.py script.

### Stop Fontra Server
Find and kill the Python process running the Fontra server:
```bash
taskkill /F /IM python.exe
```
Or find the specific process:
```bash
wmic process where "name='python.exe'" get processid,commandline
```

### Check Server Status
Check if the Fontra server is running by testing port 8000:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000
```
Or check if python process is running:
```bash
tasklist | findstr python
```

## Requirements
- Python 3.8+
- Fontra dependencies installed (see requirements.txt)
- Port 8000 available

## Notes
- Default server runs on http://localhost:8000
- Server entry point is fontra.__main__.main()
- Run from project root: D:\DEVWEB\MINIMAX AGENT\fontra\fontra
