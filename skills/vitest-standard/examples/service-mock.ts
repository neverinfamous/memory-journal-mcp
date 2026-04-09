import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Intercept external module
vi.mock('./api', () => ({
  fetchUser: vi.fn(),
  updateUser: vi.fn()
}));

// Mock instance for Dependency Injection
const mockDb = {
  save: vi.fn().mockResolvedValue({ id: '123' }),
  delete: vi.fn().mockResolvedValue(true)
};

describe('UserService', () => {
    let service: UserService;

    beforeEach(() => {
        service = new UserService(mockDb as any);
        vi.clearAllMocks(); // Clear call history between tests
    });

    afterEach(() => {
        vi.restoreAllMocks(); // Restore spies/intercepted methods
    });

    it('should save user to database', async () => {
        // Arrange
        const user = { name: 'John Doe' };
        
        // Act
        const result = await service.saveUser(user);

        // Assert
        expect(mockDb.save).toHaveBeenCalledOnce();
        expect(mockDb.save).toHaveBeenCalledWith(user);
        expect(result.id).toBe('123');
    });

    it('should throw error for invalid id', async () => {
        // Arrange
        mockDb.save.mockRejectedValueOnce(new Error('Invalid ID'));
        
        // Act & Assert (Async Error Path)
        await expect(service.saveUser({ name: '' })).rejects.toThrow('Invalid ID');
    });
});

class UserService {
    constructor(private db: Database) {}
    async saveUser(user: any) {
        return this.db.save(user);
    }
}

class Database {
    async save(user: any): Promise<any> { return { id: '' }; }
}
