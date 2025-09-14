@echo off
echo Rebuilding Docker images with LICENSE file included...
echo.

echo === Building lite version with LICENSE ===
docker build -f Dockerfile.lite -t writenotenow/memory-journal-mcp:lite .
echo.

echo === Building full version with LICENSE ===
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:latest .
echo.

echo === Pushing lite version ===
docker push writenotenow/memory-journal-mcp:lite
echo.

echo === Pushing full version ===
docker push writenotenow/memory-journal-mcp:latest
echo.

echo === Verification ===
echo Testing LICENSE file inclusion:
docker run --rm writenotenow/memory-journal-mcp:lite ls -la LICENSE
echo.

echo === Complete! ===
echo Docker images now include LICENSE file for full compliance
echo.

pause