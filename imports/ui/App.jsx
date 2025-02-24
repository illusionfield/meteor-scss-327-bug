import React from 'react';
import { Hello } from './Hello.jsx';
import { Info } from './Info.jsx';
import { Tmp } from './components/tmp/Tmp.jsx';

export const App = () => (
  <div>
    <h1>Welcome to Meteor!</h1>
    <Hello/>
    <Info/>
    <Tmp/>
  </div>
);
