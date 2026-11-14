'use strict';

const form = document.querySelector('#csrfForm');

const feedback = document.querySelector('#feedback');

form.addEventListener('submit', () => {

  feedback.textContent =
    'Форма отправлена в локальную лабораторию. ' +
    'Переключись на Northstar Bank и обнови журнал эксперимента, ' +
    'чтобы увидеть результат.';

});