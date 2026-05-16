import "@testing-library/jest-dom";

// jsdom doesn't implement scrollIntoView — provide a no-op
Element.prototype.scrollIntoView = () => {};
