---
title: "React/Okta SSO Portal Solution"
date: 2024-02-15
description: "A React and Okta single sign-on portal proof of concept for AmeriLife Career, covering agent sign-in, registration, and an authenticated dashboard."
tags: [ux-design, authentication, sso, react, okta]
tools: []
cover: "/images/portfolio/react-okta-sso-portal/cover.png"
behance: "https://www.behance.net/gallery/191608241/ReactOkta-SSO-Portal-Solution"
images:
  - src: "/images/portfolio/react-okta-sso-portal/01.png"
    alt: "AmeriLife Career sign-in screen at a custom Okta identity domain, with fields for National Producer Number and password next to a green panel promoting agent registration."
  - src: "/images/portfolio/react-okta-sso-portal/02.png"
    alt: "AmeriLife Career account registration form with First Name, Last Name, Email, SSN, and Password fields, a password strength meter, and tips for a strong password."
  - src: "/images/portfolio/react-okta-sso-portal/03.png"
    alt: "AmeriLife Agent Dashboard showing pending contracts, commissions by product, conversion rate, client retention rate, and personalized insight callouts."
---

This is a proof-of-concept single sign-on portal for AmeriLife Career, the agent-facing platform for AmeriLife's insurance sales network.
The project demonstrates a full authentication flow built with React and Okta: a branded sign-in screen, a self-service registration form, and an authenticated agent dashboard.

The sign-in screen sits at a custom Okta identity domain and asks for an agent's National Producer Number and password, alongside a call to action for agents who still need to register.
The registration form collects first name, last name, email, and SSN, and includes a live password-strength meter with tips for choosing a strong password.
Once signed in, agents land on a dashboard summarizing pending contracts, commissions by product, conversion rate, and client retention rate, along with personalized insight callouts.
