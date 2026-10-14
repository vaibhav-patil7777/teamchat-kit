@echo off
echo ===== TeamChat setup =====
python --version >nul 2>&1
if errorlevel 1 (
  echo Python is not installed. Install Python 3.11 or 3.12 from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add python.exe to PATH" in the installer, then run this file again.
  pause
  exit /b 1
)
cd backend
if not exist venv python -m venv venv
call venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
python manage.py migrate
python manage.py create_admin
echo.
echo ===== Setup complete! Now run start.bat and open http://localhost:8000 =====
pause
