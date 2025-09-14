@echo off
echo Rebuilding and pushing Docker images...
echo.

echo === Building lite version (this will take a few minutes) ===
docker build -f Dockerfile.lite -t writenotenow/memory-journal-mcp:lite .
echo.

echo === Building full version (this will take longer - ~10-15 minutes) ===
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:latest .
echo.

echo === Pushing lite version ===
docker push writenotenow/memory-journal-mcp:lite
echo.

echo === Pushing full version ===
docker push writenotenow/memory-journal-mcp:latest
echo.

echo === Success! ===
echo Both images rebuilt and pushed to Docker Hub
echo - writenotenow/memory-journal-mcp:lite
echo - writenotenow/memory-journal-mcp:latest
echo.

pause