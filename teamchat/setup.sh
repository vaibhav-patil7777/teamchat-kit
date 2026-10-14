#!/bin/bash
set -e
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python manage.py migrate
python manage.py create_admin
echo "Setup complete. Run ./start.sh and open http://localhost:8000"
