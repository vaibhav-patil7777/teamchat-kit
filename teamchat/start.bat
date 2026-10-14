@echo off
cd backend
call venv\Scripts\activate
echo TeamChat is starting on http://localhost:8000  (press Ctrl+C to stop)
python manage.py runserver 0.0.0.0:8000
pause
