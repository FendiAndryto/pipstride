import React from 'react';

// Renders translation strings that carry inline emphasis:
//   **bold**   `code`   _italic_
// Keeps paragraphs translatable as one sentence instead of sentence fragments.
// Italic requires word boundaries so underscores inside URLs stay literal.
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|(?<=^|[\s(])_[^_\s][^_]*_(?=$|[\s).,;:!?]))/g;

export default function RichText({ text }) {
  if (!text) return null;
  return (
    <>
      {String(text)
        .split(TOKEN)
        .map((part, i) => {
          if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i}>{part.slice(2, -2)}</strong>;
          }
          if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
            return <code key={i}>{part.slice(1, -1)}</code>;
          }
          if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) {
            return <em key={i}>{part.slice(1, -1)}</em>;
          }
          return part;
        })}
    </>
  );
}
