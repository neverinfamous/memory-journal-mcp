import asyncio
import sys
import os

# Add src to path
src_path = os.path.join(os.path.dirname(__file__), 'src')
sys.path.insert(0, src_path)

# Import after path is set - use absolute path
from src.vector_search import VectorSearchManager, VECTOR_SEARCH_AVAILABLE  # type: ignore[import-not-found]


async def test_semantic_search() -> None:
    print(f"VECTOR_SEARCH_AVAILABLE: {VECTOR_SEARCH_AVAILABLE}")
    
    if not VECTOR_SEARCH_AVAILABLE:
        print("Vector search not available - packages not found")
        return
    
    # Create vector search manager
    vm = VectorSearchManager('memory_journal.db')
    
    print("Initializing vector search...")
    try:
        await vm.ensure_initialized()
        print(f"Initialized: {vm.initialized}")
        
        if vm.initialized:
            print(f"Model: {vm.model}")
            if vm.faiss_index is not None:
                print(f"FAISS index total: {vm.faiss_index.ntotal}")
        else:
            print("Failed to initialize")
    except Exception as e:
        print(f"Error during initialization: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_semantic_search())

