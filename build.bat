@echo off
echo Building NEON STREET RUN executable...
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo Building...
npm run build

echo Done! Check the dist/ folder for the installer.
pause