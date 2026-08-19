import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

loadEnv();

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`Book Illustrator API listening on http://localhost:${port}`);
});
