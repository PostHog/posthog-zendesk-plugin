# PostHog Zendesk Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

## ZenDesk Account Details

Make sure to use Admin Account to perform below activities.

### Locate SubDomain

+ Head Over to Admin Section -> Settings -> Account. Refer Below
<img src="readme-assets/1.png" height="500">
+ In Branding Section, Scroll Down to Subdomain and you can find your subdomain there. Refer Below.
<img src="readme-assets/2.png" >

### Get Authentication Token

+ Head Over to Admin Section -> Channels -> API. Refer Below
<img src="readme-assets/3.png" height="500">
+ In Settings, Follow Below Steps:
  + Turn On Token Access.
  + Click on Add API Token.
  + Give it some name like PostHog.
  + Copy the Token(You won't be able to see it later).
  + Save the Token.
  + Refer Below
  <img src="readme-assets/4.png" >
  

### Create Custom User Fields

+ Head Over to Admin Section -> Manage -> User Fields. Refer Below.
<img src="readme-assets/5.png" height="500">

+ Click on Add Fields.
<img src="readme-assets/6.png" >
+ Follow Steps to create User Field.
  + Give Name
  + Select Type `Date`.
  + Add field key, (you will be required to share this key in PostHog while setting up)
  + Click Save, Refer Below.
    <img src="readme-assets/7.png" height="500">

## Plugin Features

+ Import new and historic ticket events to PostHog.
+ Only Date Type User Field is supported.
+ ZenDesk API have a limit of 400hits/min. If you have higher inflow than that, Please Contact Zendesk.
