import React from 'react'
import { render } from 'react-dom'
import { App } from './App'
import { Provider } from './components/Store'

if (module.hot) {
  module.hot.accept()
}

render(
  <Provider>
    <App />
  </Provider>,
  document.querySelector('#app')
)