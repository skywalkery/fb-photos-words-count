'use latest';

import express from 'express';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
const app = express();

app.use(bodyParser.json());

app.get('/', (req, res) => {
  const HTML = renderView({
    title: 'FB Photos Words Cloud',
  });

  res.set('Content-Type', 'text/html');
  res.status(200).send(HTML);
});

module.exports = fromExpress(app);

function renderView(locals) {
  return `
    <!DOCTYPE html>
    <html>
        <head>
            <meta charset="utf-8">
            <title>${locals.title}</title>
        </head>

        <body>
            <div>

            </div>
        </body>
    </html>
  `;
}
