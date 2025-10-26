import asyncio
import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

# Import after path is set
from server import VectorSearchManager, thread_pool, VECTOR_SEARCH_AVAILABLE

async def test_semantic_search():
    print(f"VECTOR_SEARCH_AVAILABLE: {VECTOR_SEARCH_AVAILABLE}")
    
    if not VECTOR_SEARCH_AVAILABLE:
        print("Vector search not available - packages not found")
        return
    
    # Create vector search manager
    vm = VectorSearchManager('memory_journal.db')
    
    print("Initializing vector search...")
    try:
        await vm._ensure_initialized()
        print(f"Initialized: {vm.initialized}")
        
        if vm.initialized:
            print(f"Model: {vm.model}")
            print(f"FAISS index total: {vm.faiss_index.ntotal}")
        else:
            print("Failed to initialize")
    except Exception as e:
        print(f"Error during initialization: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_semantic_search())

