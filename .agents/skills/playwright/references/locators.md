# Playwright Locators Priority

1.  **Role**: `page.getByRole('button', { name: 'Submit' })`
2.  **Label**: `page.getByLabel('User Name')`
3.  **Placeholder**: `page.getByPlaceholder('Search...')`
4.  **Text**: `page.getByText('Success')`
5.  **TestID**: `page.getByTestId('submit-btn')` (Last resort)
