@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instaluji zavislosti, chvili strpeni...
  call npm install
)
call npm start
