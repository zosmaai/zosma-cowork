---
name: hooks-pattern
description: Teaches React Hooks for reusing stateful logic across components. Use when extracting shared behavior like form handling, subscriptions, or side effects into reusable custom hooks.
context: fork
allowed-tools: Read, Grep, Glob
paths:
  - "**/*.tsx"
  - "**/*.jsx"
license: MIT
metadata:
  author: patterns.dev
  version: "1.1"
related_skills:
  - "hoc-pattern"
  - "render-props-pattern"
---

# Hooks Pattern

## Table of Contents

- [When to Use](#when-to-use)
- [Instructions](#instructions)
- [Details](#details)
- [Source](#source)

React 16.8 introduced a new feature called [**Hooks**](https://react.dev/reference/react/hooks). Hooks make it possible to use React state and lifecycle methods, without having to use an ES2015 class component.

Although Hooks are not necessarily a design pattern, Hooks play a very important role in your application design. Many traditional design patterns can be replaced by Hooks.

## When to Use

- Use this when you need to add state or lifecycle behavior to functional components
- This is helpful for extracting and reusing stateful logic across multiple components
- Use this instead of class components for cleaner, more composable code

## Instructions

- Use `useState` for local state and `useEffect` for side effects in functional components
- Create custom hooks (prefixed with `use`) to encapsulate and share reusable logic
- Follow the Rules of Hooks: only call hooks at the top level and only in React functions
- Avoid unnecessary `useEffect` — compute derived state directly in the component body
- Let the React Compiler handle memoization instead of manual `useMemo`/`useCallback` where possible

## Details

### Class components

Before Hooks were introduced in React, we had to use class components in order to add state and lifecycle methods to components. A typical class component in React can look something like:

```js
class MyComponent extends React.Component {
  /* Adding state and binding custom methods */
  constructor() {
    super()
    this.state = { ... }

    this.customMethodOne = this.customMethodOne.bind(this)
    this.customMethodTwo = this.customMethodTwo.bind(this)
  }

  /* Lifecycle Methods */
  componentDidMount() { ...}
  componentWillUnmount() { ... }

  /* Custom methods */
  customMethodOne() { ... }
  customMethodTwo() { ... }

  render() { return { ... }}
}
```

A class component can contain a state in its constructor, lifecycle methods such as `componentDidMount` and `componentWillUnmount` to perform side effects based on a component's lifecycle, and custom methods to add extra logic to a class.

Although we can still use class components after the introduction of React Hooks, using class components can have some downsides! Let's look at some of the most common issues when using class components.

#### Understanding ES2015 classes

Since class components were the only component that could handle state and lifecycle methods before React Hooks, we often ended up having to refactor functional components into a class components, in order to add the extra functionality.

In this example, we have a simple `div` that functions as a button.

```js
function Button() {
  return <div className="btn">disabled</div>;
}
```

Instead of always displaying `disabled`, we want to change it to `enabled` when the user clicks on the button, and add some extra CSS styling to the button when that happens.

In order to do that, we need to add state to the component in order to know whether the status is `enabled` or `disabled`. This means that we'd have to refactor the functional component entirely, and make it a class component that keeps track of the button's state.

```js
export default class Button extends React.Component {
  constructor() {
    super();
    this.state = { enabled: false };
  }

  render() {
    const { enabled } = this.state;
    const btnText = enabled ? "enabled" : "disabled";

    return (
      <div
        className={`btn enabled-${enabled}`}
        onClick={() => this.setState({ enabled: !enabled })}
      >
        {btnText}
      </div>
    );
  }
}
```

In this example, the component is very small and refactoring wasn't a such a great deal. However, your real-life components probably contain of many more lines of code, which makes refactoring the component a lot more difficult.

Besides having to make sure you don't accidentally change any behavior while refactoring the component, you also need to **understand how ES2015 classes work**. Why do we have to `bind` the custom methods? What does the `constructor` do? Where does the `this` keyword come from? It can be difficult to know how to refactor a component properly without accidentally changing the data flow.

#### Restructuring

The common way to share code among several components, is by using the Higher Order Component or Render Props pattern. Although both patterns are valid and a good practice, adding those patterns at a later point in time requires you to restructure your application.

Besides having to restructure your app, which is trickier the bigger your components are, having many wrapping components in order to share code among deeper nested components can lead to something that's best referred to as a _**wrapper hell**_. It's not uncommon to open your dev tools and seeing a structure similar to:

```js
<WrapperOne>
  <WrapperTwo>
    <WrapperThree>
      <WrapperFour>
        <WrapperFive>
          <Component>
            <h1>Finally in the component!</h1>
          </Component>
        </WrapperFive>
      </WrapperFour>
    </WrapperThree>
  </WrapperTwo>
</WrapperOne>
```

The _wrapper hell_ can make it difficult to understand how data is flowing through your application, which can make it harder to figure out why unexpected behavior is happening.

#### Complexity

As we add more logic to class components, the size of the component increases fast. Logic within that component can get **tangled and unstructured**, which can make it difficult for developers to understand where certain logic is used in the class component. This can make debugging and optimizing performance more difficult.

Lifecycle methods also require quite a lot of duplication in the code.

Although a component may be small, the logic within the component can already be quite tangled. Whereas certain parts are specific for the `counter` logic, other parts are specific for the `width` logic. As your component grows, it can get increasingly difficult to structure logic within your component, find related logic within the component.

Besides tangled logic, we're also **duplicating** some logic within the lifecycle methods. In both `componentDidMount` and `componentWillUnmount`, we're customizing the behavior of the app based on the window's `resize` event.


### Hooks

It's quite clear that class components aren't always a great feature in React. In order to solve the common issues that React developers can run into when using class components, React introduced **React Hooks**. React Hooks are functions that you can use to manage a components state and lifecycle methods. React Hooks make it possible to:

- add state to a functional component
- manage a component's lifecycle without having to use lifecycle methods such as `componentDidMount` and `componentWillUnmount`
- reuse the same stateful logic among multiple components throughout the app

First, let's take a look at how we can add state to a functional component, using React Hooks.

#### State Hook

React provides a hook that manages state within a functional component, called `useState`.

Let's see how a class component can be restructured into a functional component, using the `useState` hook. We have a class component called `Input`, which simply renders an input field. The value of `input` in the state updates, whenever the user types anything in the input field.

```js
class Input extends React.Component {
  constructor() {
    super();
    this.state = { input: "" };

    this.handleInput = this.handleInput.bind(this);
  }

  handleInput(e) {
    this.setState({ input: e.target.value });
  }

  render() {
    <input onChange={handleInput} value={this.state.input} />;
  }
}
```

In order to use the `useState` hook, we need to access the `useState` method that React provides for us. The `useState` method expects an argument: this is the initial value of the state, an empty string in this case.

We can destructure two values from the `useState` method:

1. The **current value** of the state.
2. The **method with which we can update** the state.

```js
const [value, setValue] = React.useState(initialValue);
```

The first value can be compared to a class component's `this.state.[value]`.
The second value can be compared to a class component's `this.setState` method.

Since we're dealing with the value of an input, let's call the current value of the state `input`, and the method in order to update the state `setInput`. The initial value should be an empty string.

```js
const [input, setInput] = React.useState("");
```

We can now refactor the `Input` class component into a stateful functional component.

```js
function Input() {
  const [input, setInput] = React.useState("");

  return <input onChange={(e) => setInput(e.target.value)} value={input} />;
}
```

The value of the `input` field is equal to the current value of the `input` state, just like in the class component example. When the user types in the input field, the value of the `input` state updates accordingly, using the `setInput` method.

#### Effect Hook

We've seen we can use the `useState` component to handle state within a functional component, but another benefit of class components was the possibility to add lifecycle methods to a component.

With the `useEffect` hook, we can _"hook into"_ a components lifecycle. The `useEffect` hook effectively combines the `componentDidMount`, `componentDidUpdate`, and `componentWillUnmount` lifecycle methods.

```js
componentDidMount() { ... }
useEffect(() => { ... }, [])

componentWillUnmount() { ... }
useEffect(() => { return () => { ... } }, [])

componentDidUpdate() { ... }
useEffect(() => { ... })
```

Let's use the input example we used in the State Hook section. Whenever the user is typing anything in the input field, we also want to log that value to the console.

We need to use a `useEffect` hook that "listens" to the `input` value. We can do so, by adding `input` to the **dependency array** of the `useEffect` hook. The dependency array is the second argument that the `useEffect` hook receives.

```js
useEffect(() => {
  console.log(`The user typed ${input}`);
}, [input]);
```

The value of the input now gets logged to the console whenever the user types a value.

### Custom Hooks

Besides the built-in hooks that React provides (`useState`, `useEffect`, `useReducer`, `useRef`, `useContext`, `useMemo`, `useImperativeHandle`, `useLayoutEffect`, `useDebugValue`, `useCallback`), we can easily create our own custom hooks.

You may have noticed that all hooks start with `use`. It's important to start your hooks with `use` in order for React to check if it violates the [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks).

Let's say we want to keep track of certain keys the user may press when writing the input. Our custom hook should be able to receive the key we want to target as its argument.

```js
function useKeyPress(targetKey) {
  const [keyPressed, setKeyPressed] = React.useState(false);

  function handleDown({ key }) {
    if (key === targetKey) {
      setKeyPressed(true);
    }
  }

  function handleUp({ key }) {
    if (key === targetKey) {
      setKeyPressed(false);
    }
  }

  React.useEffect(() => {
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);

    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
    };
  }, []);

  return keyPressed;
}
```

Instead of keeping the key press logic local to the `Input` component, we can now reuse the `useKeyPress` hook throughout multiple components, without having to rewrite the same logic over and over.

Another great advantage of Hooks, is that the community can build and share hooks. Here are some websites that list all the hooks built by the community, and ready to use in your application:

- [React Use](https://github.com/streamich/react-use)
- [useHooks](https://usehooks.com/)
- [Collection of React Hooks](https://nikgraf.github.io/react-hooks/)

By rewriting the counter and width example using React Hooks, we can break the logic of the `App` function into several pieces:

- `useCounter`: A custom hook that returns the current value of `count`, an `increment` method, and a `decrement` method.
- `useWindowWidth`: A custom hook that returns the window's current width.
- `App`: A functional, stateful component that returns the `Counter` and `Width` component.

By using React Hooks instead of a class component, we were able to break the logic down into smaller, reusable pieces that separated the logic.

Using React Hooks just made it much clearer to **separate the logic** of our component into several smaller pieces. _Reusing_ the same stateful logic just became much easier, and we no longer have to rewrite functional components into class components if we want to make the component stateful. A good knowledge of ES2015 classes is no longer required, and having reusable stateful logic increases the testability, flexibility and readability of components.

### Additional Hooks guidance

Like other components, there are special functions that are used when you want to add Hooks to the code you have written. Here's a brief overview of some common Hook functions:

#### `useState`

The `useState` Hook enables developers to update and manipulate state inside function components without needing to convert it to a class component. One advantage of this Hook is that it is simple and does not require as much complexity as other React Hooks.

#### `useEffect`

The `useEffect` Hook is used to run code during major lifecycle events in a function component. The main body of a function component does not allow mutations, subscriptions, timers, logging, and other side effects. If they are allowed, it could lead to confusing bugs and inconsistencies within the UI. The useEffect hook prevents all of these "side effects" and allows the UI to run smoothly. It is a combination of `componentDidMount`, `componentDidUpdate`, and `componentWillUnmount`, all in one place.

#### `useContext`

The `useContext` Hook accepts a context object, which is the value returned from `React.createContext`, and returns the current context value for that context. The useContext Hook also works with the React Context API in order to share data throughout the app without the need to pass your app props down through various levels.

It should be noted that the argument passed to the `useContext` hook must be the context object itself and any component calling the `useContext` always re-renders whenever the context value changes.

#### `useReducer`

The `useReducer` Hook gives an alternative to `setState` and is especially preferable to it when you have complex state logic that involves multiple sub-values or when the next state depends on the previous one. It takes on a `reducer` function and an initial state input and returns the current state and a `dispatch` function as output by means of array destructuring. `useReducer` also optimizes the performance of components that trigger deep updates.

### Pros

#### Fewer lines of code

Hooks allows you group code by concern and functionality, and not by lifecycle. This makes the code not only cleaner and concise but also shorter. Below is a comparison of a simple stateful component of a searchable product data table using React, and how it looks in Hooks after using the `useState` keyword.

#### Stateful components

```js
class TweetSearchResults extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      filterText: "",
      inThisLocation: false,
    };

    this.handleFilterTextChange = this.handleFilterTextChange.bind(this);
    this.handleInThisLocationChange =
      this.handleInThisLocationChange.bind(this);
  }

  handleFilterTextChange(filterText) {
    this.setState({
      filterText: filterText,
    });
  }

  handleInThisLocationChange(inThisLocation) {
    this.setState({
      inThisLocation: inThisLocation,
    });
  }

  render() {
    return (
      <div>
        <SearchBar
          filterText={this.state.filterText}
          inThisLocation={this.state.inThisLocation}
          onFilterTextChange={this.handleFilterTextChange}
          onInThisLocationChange={this.handleInThisLocationChange}
        />
        <TweetList
          tweets={this.props.tweets}
          filterText={this.state.filterText}
          inThisLocation={this.state.inThisLocation}
        />
      </div>
    );
  }
}
```

Same component with Hooks

```js
const TweetSearchResults = ({ tweets }) => {
  const [filterText, setFilterText] = useState("");
  const [inThisLocation, setInThisLocation] = useState(false);
  return (
    <div>
      <SearchBar
        filterText={filterText}
        inThisLocation={inThisLocation}
        setFilterText={setFilterText}
        setInThisLocation={setInThisLocation}
      />
      <TweetList
        tweets={tweets}
        filterText={filterText}
        inThisLocation={inThisLocation}
      />
    </div>
  );
};
```

#### Simplifies complex components

JavaScript classes can be difficult to manage, hard to use with hot reloading and may not minify as well. React Hooks solves these problems and ensures functional programming is made easy. With the implementation of Hooks, We don't need to have class components.

#### Reusing stateful logic

Classes in JavaScript encourage multiple levels of inheritance that quickly increase overall complexity and potential for errors. However, Hooks allow you to use state, and other React features without writing a class. With React, you can always reuse stateful logic without the need to rewrite the code over and over again. This reduces the chances of errors and allows for composition with plain functions.

#### Sharing non-visual logic

Until the implementation of Hooks, React had no way of extracting and sharing non-visual logic. This eventually led to more complexities, such as the HOC patterns and Render props, just to solve a common problem. But, the introduction of Hooks has solved this problem because it allows for the extraction of stateful logic to a simple JavaScript function.

There are of course some potential downsides to Hooks worth keeping in mind:

- Have to respect its rules, without a linter plugin, it is difficult to know which rule has been broken.
- Need a considerable time practicing to use properly (Exp: useEffect).
- Be aware of the wrong use (Exp: useCallback, useMemo).

### React Hooks vs Classes

When Hooks were introduced to React, it created a new problem: how do we know when to use function components with Hooks and class components? With the help of Hooks, it is possible to get state and partial lifecycle Hooks even in function components. Hooks also allow you to use local state and other React features without writing a class.

Here are some differences between Hooks and Classes to help you decide:

| React Hooks                                               | Classes                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| It helps avoid multiple hierarchies and make code clearer | Generally, when you use HOC or renderProps, you have to restructure your App with multiple hierarchies when you try to see it in DevTools |
| It provides uniformity across React components.           | Classes confuse both humans and machines due to the need to understand binding and the context in which functions are called.             |

## Source

- [patterns.dev/react/hooks-pattern](https://patterns.dev/react/hooks-pattern)
