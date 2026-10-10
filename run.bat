@echo off
echo Starting NEON STREET RUN...
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

npm start