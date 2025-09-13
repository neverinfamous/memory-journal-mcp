#!/usr/bin/env python3
"""
Test the MCP server tool handlers directly without the MCP protocol layer.
"""

import sys
import os
import asyncio
sys.path.insert(0, 'src')

from server import call_tool

async def test_create_entry():
    """Test the create_entry tool handler directly."""
    
    print("Testing create_entry tool handler...")
    
    arguments = {
        "content": "Test entry to debug the MCP server hanging issue. This is a direct test of the tool handler without going through the MCP protocol layer.",
        "is_personal": True,
        "entry_type": "personal_reflection", 
        "tags": ["test", "debug", "mcp"],
        "auto_context": True
    }
    
    try:
        print("Calling create_entry...")
        result = await call_tool("create_entry", arguments)
        print(f"✅ Success! Result: {result}")
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_get_recent():
    """Test the get_recent_entries tool handler."""
    
    print("\nTesting get_recent_entries tool handler...")
    
    try:
        result = await call_tool("get_recent_entries", {"limit": 3})
        print(f"✅ Success! Result: {result}")
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

async def main():
    """Run all tests."""
    print("Testing MCP Tool Handlers Directly")
    print("=" * 40)
    
    success1 = await test_create_entry()
    success2 = await test_get_recent()
    
    print("=" * 40)
    if success1 and success2:
        print("✅ All tests passed!")
    else:
        print("❌ Some tests failed!")

if __name__ == "__main__":
    asyncio.run(main())
