import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEmbedderFn, mockGet, mockPrepare, mockRun, mockAll } = vi.hoisted(() => ({
    mockEmbedderFn: vi.fn(),
    mockGet: vi.fn(),
    mockPrepare: vi.fn(),
    mockRun: vi.fn(),
    mockAll: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(mockEmbedderFn),
    env: { allowRemoteModels: false, localModelPath: '' },
}))

import { VectorSearchManager } from '../../src/vector/vector-search-manager/index.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'

function createMockDbAdapter() {
    mockPrepare.mockReturnValue({
        run: mockRun,
        all: mockAll,
        get: mockGet,
    })

    const metadataStore = new Map<string, string>()

    const mockDb = {
        prepare: mockPrepare,
        exec: vi.fn(),
    }

    const adapter = {
        db: mockDb,
        getVectorMetadata: vi.fn((key: string) => metadataStore.get(key)),
        setVectorMetadata: vi.fn((key: string, value: string) => {
            metadataStore.set(key, value)
        }),
        createVecTable: vi.fn(),
        dropVecTable: vi.fn(),
        executeInTransaction: vi.fn().mockImplementation((cb) => cb()),
    } as unknown as IDatabaseAdapter

    return { adapter, metadataStore }
}

describe('Swappable Embedding Model', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should initialize with default model and detect dimensions', async () => {
        const { adapter, metadataStore } = createMockDbAdapter()
        const vm = new VectorSearchManager(adapter)
        
        mockEmbedderFn.mockResolvedValue({ data: new Float32Array(384) })
        await vm.initialize()

        expect(vm.getModelName()).toBe('Xenova/all-MiniLM-L6-v2')
        expect(vm.getDimensions()).toBe(384)
        
        expect(adapter.setVectorMetadata).toHaveBeenCalledWith('model_name', 'Xenova/all-MiniLM-L6-v2')
        expect(adapter.setVectorMetadata).toHaveBeenCalledWith('dimensions', '384')
        expect(adapter.createVecTable).toHaveBeenCalledWith(384)
    })

    it('should recreate table if model changes', async () => {
        const { adapter, metadataStore } = createMockDbAdapter()
        
        // Pretend DB has old model
        metadataStore.set('model_name', 'Xenova/all-MiniLM-L6-v2')
        metadataStore.set('dimensions', '384')

        const vm = new VectorSearchManager(adapter, { modelName: 'NewModel/Tiny-v1' })
        mockEmbedderFn.mockResolvedValue({ data: new Float32Array(128) })
        await vm.initialize()

        expect(vm.getModelName()).toBe('NewModel/Tiny-v1')
        expect(vm.getDimensions()).toBe(128)

        expect(adapter.dropVecTable).toHaveBeenCalled()
        expect(adapter.createVecTable).toHaveBeenCalledWith(128)
        expect(metadataStore.get('model_name')).toBe('NewModel/Tiny-v1')
        expect(metadataStore.get('dimensions')).toBe('128')
    })
})
