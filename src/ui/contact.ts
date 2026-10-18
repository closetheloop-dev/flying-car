/**
 * The site's contact address, only as a picture (public/contact.png, with "[at]" for the @),
 * so neither this code nor the page carries any part of it as text for harvesters to read.
 * Visitors type it into their mail app themselves.
 */

/** The contact picture, sized to the text around it. */
export const contactImage = () =>
  `<img class="contact-img" src="/contact.png" alt="The contact email address, shown as a picture" />`;
