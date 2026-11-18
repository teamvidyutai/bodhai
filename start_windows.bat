@echo off
echo BodhAI Backend Setup
echo ====================
echo.

REM Check Node.js
node --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo ERROR: Node.js not found. Download from nodejs.org
  pause
  exit /b 1
)

REM Check MySQL
mysql --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo ERROR: MySQL not found. Download from mysql.com
  pause
  exit /b 1
)

REM Create .env if not exists
IF NOT EXIST .env (
  copy .env.example .env
  echo Created .env file - please edit with your MySQL password!
  notepad .env
  pause
)

REM Install dependencies
echo Installing Node.js packages...
npm install

REM Setup database
echo Setting up MySQL database...
node setup.js

REM Copy HTML files to public folder
IF EXIST ..\BodhAI_Student.html (
  copy ..\BodhAI_Student.html public\
  copy ..\BodhAI_Teacher.html public\
  echo HTML files copied to public/
)

echo.
echo Starting BodhAI server...
npm start
