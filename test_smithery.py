#!/usr/bin/env python3
"""
Test script for Smithery HTTP MCP server
"""

import asyncio
import json
import aiohttp

async def test_smithery_server():
    """Test the HTTP MCP server endpoints."""
    base_url = "http://localhost:8000"
    
    async with aiohttp.ClientSession() as session:
        # Test health endpoint
        print("🔍 Testing health endpoint...")
        try:
            async with session.get(f"{base_url}/health") as resp:
                health_data = await resp.json()
                print(f"✅ Health check: {health_data}")
        except Exception as e:
            print(f"❌ Health check failed: {e}")
            return
        
        # Test MCP info endpoint
        print("\n🔍 Testing MCP info endpoint...")
        try:
            async with session.get(f"{base_url}/mcp") as resp:
                info_data = await resp.json()
                print(f"✅ MCP info: {json.dumps(info_data, indent=2)}")
        except Exception as e:
            print(f"❌ MCP info failed: {e}")
        
        # Test MCP request
        print("\n🔍 Testing MCP request...")
        mcp_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0.0"
                }
            }
        }
        
        try:
            async with session.post(
                f"{base_url}/mcp",
                json=mcp_request,
                headers={"Content-Type": "application/json"}
            ) as resp:
                mcp_data = await resp.json()
                print(f"✅ MCP request: {json.dumps(mcp_data, indent=2)}")
        except Exception as e:
            print(f"❌ MCP request failed: {e}")

if __name__ == "__main__":
    print("🧪 Testing Memory Journal MCP Server (Smithery HTTP version)")
    print("📋 Make sure to start the server first with: python src/server_http.py")
    print()
    
    asyncio.run(test_smithery_server())