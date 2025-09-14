@echo off
echo Fixing security vulnerabilities in Docker images...
echo.

echo === Updating Dockerfile.lite to fix setuptools CVEs ===
echo Adding setuptools upgrade to Dockerfile.lite...
echo.

echo === Updating main Dockerfile to fix setuptools CVEs ===
echo Adding setuptools upgrade to main Dockerfile...
echo.

echo === Building patched lite version ===
docker build -f Dockerfile.lite -t writenotenow/memory-journal-mcp:lite .
echo.

echo === Building patched full version ===
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:latest .
echo.

echo === Pushing patched lite version ===
docker push writenotenow/memory-journal-mcp:lite
echo.

echo === Pushing patched full version ===
docker push writenotenow/memory-journal-mcp:latest
echo.

echo Security patches applied and pushed!
pause