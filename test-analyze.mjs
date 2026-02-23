import FormData from 'form-data';

const fd = new FormData();
fd.append('mode', 'note');
fd.append('documentText', 'test');
fd.append('audioText', '');
fd.append('targetLength', '1000');

try {
  const res = await fetch('http://localhost:5173/api/analyze', {
    method: 'POST',
    body: fd
  });

  console.log('Status:', res.status);
  console.log('Text:', await res.text());
} catch(e) {
  console.log(e);
}
