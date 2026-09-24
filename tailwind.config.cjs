/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './dist/index.html'],
  theme: {
    extend: {
      colors: { violet: '#4c1649', aubergine: '#260d2f', wine: '#6b1d59', gold: '#d5a942', cream: '#f8f1df', mist: '#f1ebf5' },
      fontFamily: { sans: ['Manrope', 'sans-serif'], heading: ['Montserrat', 'sans-serif'] },
      boxShadow: { glow: '0 0 0 1px rgba(213,169,66,.28), 0 25px 80px rgba(15,3,25,.42)' }
    }
  }
};
