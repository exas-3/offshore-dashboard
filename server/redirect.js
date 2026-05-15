import http from 'http';

const PORT = process.env.PORT || 3001;
const TARGET = 'https://offshoredashboard.xyz/';

http.createServer((req, res) => {
  res.writeHead(301, { Location: TARGET });
  res.end();
}).listen(PORT, () => {
  console.log(`Redirecting all traffic to ${TARGET} on port ${PORT}`);
});
