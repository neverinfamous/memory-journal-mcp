#!/usr/bin/env python3
"""
Memory Journal MCP Server - HTTP Version for Smithery
A Model Context Protocol server for personal journaling with context awareness.
This version supports HTTP transport for deployment on Smithery.
"""

import asyncio
import json
import os
import sys
from urllib.parse import parse_qs, urlparse
from aiohttp import web
import aiohttp_cors

# Import the main server logic
from server import server, InitializationOptions

async def handle_mcp(request):
    """Handle MCP requests over HTTP."""
    try:
        # Get configuration from query parameters
        config = {}
        for key, value in request.query.items():
            if key.startswith('config_'):
                config_key = key[7:]  # Remove 'config_' prefix
                config[config_key] = value
        
        # Apply configuration
        if 'dataPath' in config:
            os.environ['DB_PATH'] = config['dataPath']
        if 'logLevel' in config:
            os.environ['LOG_LEVEL'] = config['logLevel']
            
        # Handle POST request with MCP protocol
        if request.method == 'POST':
            body = await request.json()
            
            # Create mock streams for compatibility with existing server code
            class MockStream:
                def __init__(self):
                    self.messages = []
                    
                async def send(self, message):
                    self.messages.append(message)
                    
                async def recv(self):
                    return body
            
            mock_read_stream = MockStream()
            mock_write_stream = MockStream()
            
            # Process the MCP request
            try:
                await server.run(
                    mock_read_stream,
                    mock_write_stream,
                    InitializationOptions(
                        server_name="memory-journal",
                        server_version="1.0.0",
                        capabilities=server.get_capabilities(
                            notification_options={},
                            experimental_capabilities={},
                        ),
                    ),
                )
                
                # Return the response
                if mock_write_stream.messages:
                    return web.json_response(mock_write_stream.messages[-1])
                else:
                    return web.json_response({"result": "success"})
                    
            except Exception as e:
                return web.json_response(
                    {"error": {"code": -32603, "message": str(e)}}, 
                    status=500
                )
        
        # Handle GET request - return server info
        elif request.method == 'GET':
            return web.json_response({
                "name": "memory-journal",
                "version": "1.0.0",
                "description": "A Model Context Protocol server for personal journaling with context awareness",
                "capabilities": {
                    "tools": True,
                    "resources": True,
                    "prompts": True
                },
                "status": "ready"
            })
            
    except Exception as e:
        return web.json_response(
            {"error": {"code": -32603, "message": f"Server error: {str(e)}"}}, 
            status=500
        )

async def health_check(request):
    """Health check endpoint."""
    return web.json_response({"status": "healthy", "service": "memory-journal-mcp"})

async def create_app():
    """Create the HTTP server application."""
    app = web.Application()
    
    # Configure CORS
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*"
        )
    })
    
    # Add routes
    mcp_resource = cors.add(app.router.add_resource("/mcp"))
    cors.add(mcp_resource.add_route("GET", handle_mcp))
    cors.add(mcp_resource.add_route("POST", handle_mcp))
    cors.add(mcp_resource.add_route("OPTIONS", handle_mcp))
    
    health_resource = cors.add(app.router.add_resource("/health"))
    cors.add(health_resource.add_route("GET", health_check))
    
    return app

async def main():
    """Run the HTTP server."""
    app = await create_app()
    
    # Get port from environment or default to 8000
    port = int(os.environ.get('PORT', 8000))
    
    print(f"Starting Memory Journal MCP Server on port {port}")
    print("Endpoints:")
    print(f"  - MCP: http://localhost:{port}/mcp")
    print(f"  - Health: http://localhost:{port}/health")
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    
    print("Server started successfully!")
    
    # Keep the server running
    try:
        await asyncio.Future()  # Run forever
    except KeyboardInterrupt:
        print("Shutting down server...")
    finally:
        await runner.cleanup()

if __name__ == "__main__":
    asyncio.run(main())