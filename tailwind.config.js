/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./js/**/*.js"],
  theme: {
    extend: {
      colors: {
        kcblue: '#165DFF',
        kcdark: '#0F2B73',
        kclight: '#EEF5FF',
        kcyellow: '#FFC72C',
        kcsoft: '#F7FAFF',
        kcborder: '#E6EDF7',
      },
      fontFamily: {
        sarabun: ['Sarabun', 'sans-serif'],
      },
    },
  },
  plugins: [],
}