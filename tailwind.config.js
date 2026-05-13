/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        kcblue: '#0B2B5E',
        kcyellow: '#FFD600',
      },
      fontFamily: {
        sarabun: ['Sarabun', 'sans-serif'],
      },
    },
  },
  plugins: [],
}