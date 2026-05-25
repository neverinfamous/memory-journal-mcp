import { test as base, Page, Browser, BrowserContext } from '@playwright/test'

// 1. Define the fixture type
type MyFixtures = {
    todoPage: TodoPage
    authenticatedUser: User
}

// 2. Extend the base test with your fixture
export const test = base.extend<MyFixtures>({
    todoPage: async ({ page }: { page: Page }, use: (r: TodoPage) => Promise<void>) => {
        // Setup (Isolation over globals)
        const todoPage = new TodoPage(page)
        await todoPage.goto()

        // Pass the fixture to the test
        await use(todoPage)

        // Teardown (optional)
        await todoPage.removeAll()
    },

    authenticatedUser: async (
        { browser }: { browser: Browser },
        use: (r: User) => Promise<void>
    ) => {
        // Shared state (StorageState over login-in-each-test)
        const context = await browser.newContext({ storageState: 'auth.json' })
        const user = new User(context)
        await use(user)
        await context.close()
    },
})

export { expect } from '@playwright/test'

// 3. Usage inside a test file
/*
import { test, expect } from './fixtures';

test('create a todo', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk');
  await expect(todoPage.todoList.locator('li')).toHaveText(['buy milk']);
});
*/

class TodoPage {
    public todoList: any // Using any for example simplicity, but it's initialized in constructor
    constructor(private page: Page) {
        this.todoList = this.page.locator('ul')
    }
    async goto() {
        await this.page.goto('/todo')
    }
    async removeAll() {
        /* ... */
    }
    async addTodo(text: string) {
        await this.page.fill('input', text)
        await this.page.click('text=Add')
    }
}

class User {
    constructor(private context: BrowserContext) {}
}
