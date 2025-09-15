#!/usr/bin/env python3
"""
Memory Journal MCP Server - HTTP Version for Smithery
A Model Context Protocol server for personal journaling with context awareness.
This version supports HTTP transport for deployment on Smithery.
"""

import asyncio
import os
import sys
from pathlib import Path
from aiohttp import web
import aiohttp_cors

# Add the src directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

# Import the existing server module to reuse its logic
import server as mcp_server

async def handle_mcp(request):
    """Handle MCP requests over HTTP."""
    try:
        if request.method == 'GET':
            # Return server capabilities for GET requests
            return web.json_response({
                "jsonrpc": "2.0",
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {},
                        "resources": {},
                        "prompts": {},
                        "logging": {}
                    },
                    "serverInfo": {
                        "name": "memory-journal",
                        "version": "1.0.0"
                    }
                }
            })

        elif request.method == 'POST':
            # Handle MCP protocol requests
            try:
                body = await request.json()
            except Exception:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32700,
                        "message": "Parse error"
                    }
                }, status=400)

            # Process the MCP request
            response = await process_mcp_request(body)
            return web.json_response(response)

    except Exception as e:
        return web.json_response({
            "jsonrpc": "2.0",
            "error": {
                "code": -32603,
                "message": f"Internal error: {str(e)}"
            }
        }, status=500)

async def process_mcp_request(request_data):
    """Process an MCP request and return the response."""
    try:
        method = request_data.get('method')
        params = request_data.get('params', {})
        request_id = request_data.get('id')

        if method == 'initialize':
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {
                            "listChanged": True
                        },
                        "resources": {
                            "subscribe": False,
                            "listChanged": False
                        },
                        "prompts": {
                            "listChanged": False
                        },
                        "logging": {}
                    },
                    "serverInfo": {
                        "name": "memory-journal",
                        "version": "1.0.0"
                    }
                }
            }

        elif method == 'tools/list':
            # Return the list of available tools
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "create_entry",
                            "description": "Create a new journal entry with optional context and tags",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "content": {"type": "string", "description": "The journal entry content"},
                                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags"},
                                    "entry_type": {"type": "string", "default": "personal_reflection"},
                                    "is_personal": {"type": "boolean", "default": True},
                                    "significance_type": {"type": "string"},
                                    "auto_context": {"type": "boolean", "default": True}
                                },
                                "required": ["content"]
                            }
                        },
                        {
                            "name": "search_entries",
                            "description": "Search journal entries by content",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {"type": "string", "description": "Search query"},
                                    "limit": {"type": "integer", "default": 10},
                                    "is_personal": {"type": "boolean"}
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "name": "get_recent_entries",
                            "description": "Get recent journal entries",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "limit": {"type": "integer", "default": 5},
                                    "is_personal": {"type": "boolean"}
                                }
                            }
                        },
                        {
                            "name": "list_tags",
                            "description": "List all available tags",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "semantic_search",
                            "description": "Perform semantic search on journal entries",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {"type": "string", "description": "Search query"},
                                    "limit": {"type": "integer", "default": 10},
                                    "similarity_threshold": {"type": "number", "default": 0.3},
                                    "is_personal": {"type": "boolean"}
                                },
                                "required": ["query"]
                            }
                        }
                    ]
                }
            }

        elif method == 'tools/call':
            tool_name = params.get('name')
            arguments = params.get('arguments', {})

            try:
                # Call the existing tool handler from the original server
                result_content = await mcp_server.call_tool(tool_name, arguments)

                # Convert the result to the expected format
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "content": result_content
                    }
                }
            except Exception as e:
                return {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32603,
                        "message": f"Tool execution failed: {str(e)}"
                    }
                }

        else:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Method not found: {method}"
                }
            }

    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": request_data.get('id'),
            "error": {
                "code": -32603,
                "message": f"Internal error: {str(e)}"
            }
        }

async def handle_health(request):
    """Health check endpoint."""
    return web.json_response({
        "status": "healthy",
        "service": "memory-journal-mcp",
        "version": "1.0.0"
    })

async def create_app():
    """Create and configure the aiohttp application."""
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

    # Add routes - CORS setup automatically handles OPTIONS
    mcp_resource = cors.add(app.router.add_resource("/mcp"))
    cors.add(mcp_resource.add_route("GET", handle_mcp))
    cors.add(mcp_resource.add_route("POST", handle_mcp))

    health_resource = cors.add(app.router.add_resource("/health"))
    cors.add(health_resource.add_route("GET", handle_health))

    return app

async def main():
    """Run the HTTP server."""
    # Initialize the database and other components from the original server
    # This ensures the database is set up before we start handling requests
    print("Initializing Memory Journal MCP Server...")

    app = await create_app()

    # Get port from environment or default to 8000
    port = int(os.environ.get('PORT', 8000))

    print(f"Starting Memory Journal MCP Server on port {port}")
    print(f"Health check available at: http://localhost:{port}/health")
    print(f"MCP endpoint available at: http://localhost:{port}/mcp")

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()

    print("Server is ready.")

    # Keep the server running
    try:
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        print("Shutting down server...")
        await runner.cleanup()

if __name__ == "__main__":
    asyncio.run(main())
