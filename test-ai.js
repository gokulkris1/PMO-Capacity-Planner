import("node-fetch").then(({default: fetch}) => {
  fetch('http://localhost:4000/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token'
    },
    body: JSON.stringify({ systemPrompt: 'Sys prompt', userPrompt: 'Hello' })
  })
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
});
