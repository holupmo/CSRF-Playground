@echo off
cd /d "%~dp0"

echo Starting Northstar CSRF Playground...

if not exist node_modules (
  echo Dependencies are not installed yet.
  echo Running npm install...

  call npm install

  if errorlevel 1 (
    echo.
    echo npm install failed.
    echo Check your Node.js and internet connection.
    pause
    exit /b 1
  )
)

call npm start
pause