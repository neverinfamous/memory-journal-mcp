# WebSockets and State Management

## Basic Agent Structure

```typescript
import { Agent, Connection } from "agents";

interface Env {
  AI: Ai;  // Workers AI binding
}

interface State {
  messages: Array<{ role: string; content: string }>;
  preferences: Record<string, string>;
}

export class MyAgent extends Agent<Env, State> {
  // Initial state for new instances
  initialState: State = {
    messages: [],
    preferences: {},
  };

  // Called when agent starts or resumes
  async onStart() {
    console.log("Agent started with state:", this.state);
  }

  // Handle WebSocket connections
  async onConnect(connection: Connection) {
    connection.send(JSON.stringify({
      type: "welcome",
      history: this.state.messages,
    }));
  }

  // Handle incoming messages
  async onMessage(connection: Connection, message: string) {
    const data = JSON.parse(message);

    if (data.type === "chat") {
      await this.handleChat(connection, data.content);
    }
  }

  // Handle disconnections
  async onClose(connection: Connection) {
    console.log("Client disconnected");
  }

  // React to state changes
  onStateUpdate(state: State, source: string) {
    console.log("State updated by:", source);
  }

  private async handleChat(connection: Connection, userMessage: string) {
    // Add user message to history
    const messages = [
      ...this.state.messages,
      { role: "user", content: userMessage },
    ];

    // Call AI
    const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages,
    });

    // Update state (persists and syncs to all clients)
    this.setState({
      ...this.state,
      messages: [
        ...messages,
        { role: "assistant", content: response.response },
      ],
    });

    // Send response
    connection.send(JSON.stringify({
      type: "response",
      content: response.response,
    }));
  }
}
```

## State Management

### Reading State

```typescript
// Current state is always available
const currentMessages = this.state.messages;
const userPrefs = this.state.preferences;
```

### Updating State

```typescript
// setState persists AND syncs to all connected clients
this.setState({
  ...this.state,
  messages: [...this.state.messages, newMessage],
});

// Partial updates work too
this.setState({
  preferences: { ...this.state.preferences, theme: "dark" },
});
```

### SQL Storage

For complex queries, use the embedded SQLite database:

```typescript
// Create tables
await this.sql`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

// Insert
await this.sql`
  INSERT INTO documents (title, content)
  VALUES (${title}, ${content})
`;

// Query
const docs = await this.sql`
  SELECT * FROM documents WHERE title LIKE ${`%${search}%`}
`;
```
