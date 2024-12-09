/**
 * @license Copyright (c) 2003-2024, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-licensing-options
 */

/**
 * @module engine/view/element
 */

import Node from './node.js';
import Text from './text.js';
import TextProxy from './textproxy.js';
import { type ArrayOrItem, isIterable, toMap } from '@ckeditor/ckeditor5-utils';
import { default as Matcher, isPatternMatched, type MatcherPattern, type NormalizedPropertyPattern } from './matcher.js';
import { default as StylesMap, type Styles, type StyleValue } from './stylesmap.js';

import type Document from './document.js';
import type Item from './item.js';
import TokenList from './tokenlist.js';
import type { NormalizedConsumables } from '../conversion/viewconsumable.js';

// @if CK_DEBUG_ENGINE // const { convertMapToTags } = require( '../dev-utils/utils' );

/**
 * View element.
 *
 * The editing engine does not define a fixed semantics of its elements (it is "DTD-free").
 * This is why the type of the {@link module:engine/view/element~Element} need to
 * be defined by the feature developer. When creating an element you should use one of the following methods:
 *
 * * {@link module:engine/view/downcastwriter~DowncastWriter#createContainerElement `downcastWriter#createContainerElement()`}
 * in order to create a {@link module:engine/view/containerelement~ContainerElement},
 * * {@link module:engine/view/downcastwriter~DowncastWriter#createAttributeElement `downcastWriter#createAttributeElement()`}
 * in order to create a {@link module:engine/view/attributeelement~AttributeElement},
 * * {@link module:engine/view/downcastwriter~DowncastWriter#createEmptyElement `downcastWriter#createEmptyElement()`}
 * in order to create a {@link module:engine/view/emptyelement~EmptyElement}.
 * * {@link module:engine/view/downcastwriter~DowncastWriter#createUIElement `downcastWriter#createUIElement()`}
 * in order to create a {@link module:engine/view/uielement~UIElement}.
 * * {@link module:engine/view/downcastwriter~DowncastWriter#createEditableElement `downcastWriter#createEditableElement()`}
 * in order to create a {@link module:engine/view/editableelement~EditableElement}.
 *
 * Note that for view elements which are not created from the model, like elements from mutations, paste or
 * {@link module:engine/controller/datacontroller~DataController#set data.set} it is not possible to define the type of the element.
 * In such cases the {@link module:engine/view/upcastwriter~UpcastWriter#createElement `UpcastWriter#createElement()`} method
 * should be used to create generic view elements.
 */
export default class Element extends Node {
	/**
	 * Name of the element.
	 */
	public readonly name: string;

	/**
	 * A list of attribute names that should be rendered in the editing pipeline even though filtering mechanisms
	 * implemented in the {@link module:engine/view/domconverter~DomConverter} (for instance,
	 * {@link module:engine/view/domconverter~DomConverter#shouldRenderAttribute}) would filter them out.
	 *
	 * These attributes can be specified as an option when the element is created by
	 * the {@link module:engine/view/downcastwriter~DowncastWriter}. To check whether an unsafe an attribute should
	 * be permitted, use the {@link #shouldRenderUnsafeAttribute} method.
	 *
	 * @internal
	 */
	public readonly _unsafeAttributesToRender: Array<string> = [];

	/**
	 * Map of attributes, where attributes names are keys and attributes values are values.
	 */
	private readonly _attrs: Map<string, string | ElementAttributeValue>;

	/**
	 * Array of child nodes.
	 */
	private readonly _children: Array<Node>;

	/**
	 * Map of custom properties.
	 * Custom properties can be added to element instance, will be cloned but not rendered into DOM.
	 */
	private readonly _customProperties = new Map<string | symbol, unknown>();

	/**
	 * Set of classes associated with element instance.
	 *
	 * Note that this is just an alias for this._attrs.get( 'class' );
	 */
	private get _classes(): TokenList | undefined {
		return this._attrs.get( 'class' ) as TokenList | undefined;
	}

	/**
	 * Normalized styles.
	 *
	 * Note that this is just an alias for this._attrs.get( 'style' );
	 */
	private get _styles(): StylesMap | undefined {
		return this._attrs.get( 'style' ) as StylesMap | undefined;
	}

	/**
	 * Creates a view element.
	 *
	 * Attributes can be passed in various formats:
	 *
	 * ```ts
	 * new Element( viewDocument, 'div', { class: 'editor', contentEditable: 'true' } ); // object
	 * new Element( viewDocument, 'div', [ [ 'class', 'editor' ], [ 'contentEditable', 'true' ] ] ); // map-like iterator
	 * new Element( viewDocument, 'div', mapOfAttributes ); // map
	 * ```
	 *
	 * @internal
	 * @param document The document instance to which this element belongs.
	 * @param name Node name.
	 * @param attrs Collection of attributes.
	 * @param children A list of nodes to be inserted into created element.
	 */
	constructor(
		document: Document,
		name: string,
		attrs?: ElementAttributes,
		children?: Node | Iterable<Node>
	) {
		super( document );

		this.name = name;

		this._attrs = this._parseAttributes( attrs );
		this._children = [];

		if ( children ) {
			this._insertChild( 0, children );
		}
	}

	/**
	 * Number of element's children.
	 */
	public get childCount(): number {
		return this._children.length;
	}

	/**
	 * Is `true` if there are no nodes inside this element, `false` otherwise.
	 */
	public get isEmpty(): boolean {
		return this._children.length === 0;
	}

	/**
	 * Gets child at the given index.
	 *
	 * @param index Index of child.
	 * @returns Child node.
	 */
	public getChild( index: number ): Node | undefined {
		return this._children[ index ];
	}

	/**
	 * Gets index of the given child node. Returns `-1` if child node is not found.
	 *
	 * @param node Child node.
	 * @returns Index of the child node.
	 */
	public getChildIndex( node: Node ): number {
		return this._children.indexOf( node );
	}

	/**
	 * Gets child nodes iterator.
	 *
	 * @returns Child nodes iterator.
	 */
	public getChildren(): IterableIterator<Node> {
		return this._children[ Symbol.iterator ]();
	}

	/**
	 * Returns an iterator that contains the keys for attributes. Order of inserting attributes is not preserved.
	 *
	 * @returns Keys for attributes.
	 */
	public* getAttributeKeys(): IterableIterator<string> {
		// This is yielded in this specific order to maintain backward compatibility of data.

		if ( this._classes ) {
			yield 'class';
		}

		if ( this._styles ) {
			yield 'style';
		}

		for ( const key of this._attrs.keys() ) {
			if ( key != 'class' && key != 'style' ) {
				yield key;
			}
		}
	}

	/**
	 * Returns iterator that iterates over this element's attributes.
	 *
	 * Attributes are returned as arrays containing two items. First one is attribute key and second is attribute value.
	 * This format is accepted by native `Map` object and also can be passed in `Node` constructor.
	 */
	public* getAttributes(): IterableIterator<[ string, string ]> {
		for ( const [ name, value ] of this._attrs.entries() ) {
			yield [ name, String( value ) ];
		}
	}

	/**
	 * Gets attribute by key. If attribute is not present - returns undefined.
	 *
	 * @param key Attribute key.
	 * @returns Attribute value.
	 */
	public getAttribute( key: string ): string | undefined {
		return this._attrs.has( key ) ? String( this._attrs.get( key ) ) : undefined;
	}

	/**
	 * Returns a boolean indicating whether an attribute with the specified key exists in the element.
	 *
	 * @param key Attribute key.
	 * @returns `true` if attribute with the specified key exists in the element, `false` otherwise.
	 */
	public hasAttribute( key: string, token?: string ): boolean {
		if ( !this._attrs.has( key ) ) {
			return false;
		}

		if ( token !== undefined ) {
			if ( usesStylesMap( this.name, key ) || usesTokenList( this.name, key ) ) {
				return ( this._attrs.get( key ) as ElementAttributeValue ).has( token );
			} else {
				return this._attrs.get( key ) === token;
			}
		}

		return true;
	}

	/**
	 * Checks if this element is similar to other element.
	 * Both elements should have the same name and attributes to be considered as similar. Two similar elements
	 * can contain different set of children nodes.
	 */
	public isSimilar( otherElement: Item ): boolean {
		if ( !( otherElement instanceof Element ) ) {
			return false;
		}

		// If exactly the same Element is provided - return true immediately.
		if ( this === otherElement ) {
			return true;
		}

		// Check element name.
		if ( this.name != otherElement.name ) {
			return false;
		}

		// Check number of attributes, classes and styles.
		if ( this._attrs.size !== otherElement._attrs.size ) {
			return false;
		}

		// Check if attributes are the same.
		for ( const [ key, value ] of this._attrs ) {
			const otherValue = otherElement._attrs.get( key );

			if ( otherValue === undefined ) {
				return false;
			}

			if ( typeof value == 'string' || typeof otherValue == 'string' ) {
				if ( otherValue !== value ) {
					return false;
				}
			}
			else if ( !value.isSimilar( otherValue ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * TODO
	 */
	protected _canMergeAttributesFrom( otherElement: Element ): boolean {
		if ( this.name != otherElement.name ) {
			return false;
		}

		for ( const [ key, otherValue ] of otherElement._attrs ) {
			const value = this._attrs.get( key );

			if ( value === undefined ) {
				continue;
			}

			if ( typeof value == 'string' || typeof otherValue == 'string' ) {
				if ( value !== otherValue ) {
					return false;
				}
			}
			else if ( !value.canMergeFrom( otherValue ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * TODO
	 */
	protected _hasAttributesMatching( otherElement: Element ): boolean {
		if ( this.name != otherElement.name ) {
			return false;
		}

		for ( const [ key, otherValue ] of otherElement._attrs ) {
			const value = this._attrs.get( key );

			if ( value === undefined ) {
				return false;
			}

			if ( typeof value == 'string' || typeof otherValue == 'string' ) {
				if ( value !== otherValue ) {
					return false;
				}
			}
			else if ( !value.isMatching( otherValue ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * TODO
	 * @internal
	 */
	public _getAttributesMatch(
		patterns: Array<NormalizedPropertyPattern>,
		exclude?: Array<string>
	): Array<[ string, string? ]> | undefined {
		const match: Array<[ string, string? ]> = [];

		for ( const [ patternKey, patternToken, patternValue ] of patterns ) {
			let hasKey = false;
			let hasValue = false;

			for ( const [ key, value ] of this._attrs ) {
				if ( exclude && exclude.includes( key ) || !isPatternMatched( patternKey, key ) ) {
					continue;
				}

				hasKey = true;

				if ( typeof value == 'string' ) {
					if ( isPatternMatched( patternToken, value ) ) {
						match.push( [ key ] );
						hasValue = true;
					}
					else if ( !( patternKey instanceof RegExp ) ) {
						return undefined;
					}
				} else {
					const tokenMatch = value._getTokensMatch( key, patternToken, patternValue || true );

					if ( tokenMatch ) {
						match.push( ...tokenMatch );
						hasValue = true;
					}
					else if ( !( patternKey instanceof RegExp ) ) {
						return undefined;
					}
				}
			}

			if ( !hasKey || !hasValue ) {
				return undefined;
			}
		}

		return match;
	}

	/**
	 * TODO
	 * @internal
	 */
	public _getConsumables( key?: string, token?: string ): NormalizedConsumables {
		const attributes: Array<[string, string?]> = [];

		if ( key ) {
			const value = this._attrs.get( key );

			if ( value !== undefined ) {
				if ( typeof value == 'string' ) {
					attributes.push( [ key ] );
				}
				else {
					for ( const prop of value._getConsumables( token ) ) {
						attributes.push( [ key, prop ] );
					}
				}
			}
		} else {
			for ( const [ key, value ] of this._attrs ) {
				if ( typeof value == 'string' ) {
					attributes.push( [ key ] );
				} else {
					for ( const prop of value._getConsumables() ) {
						attributes.push( [ key, prop ] );
					}
				}
			}
		}

		return {
			name: !key,
			attributes
		};
	}

	/**
	 * Returns true if class is present.
	 * If more then one class is provided - returns true only when all classes are present.
	 *
	 * ```ts
	 * element.hasClass( 'foo' ); // Returns true if 'foo' class is present.
	 * element.hasClass( 'foo', 'bar' ); // Returns true if 'foo' and 'bar' classes are both present.
	 * ```
	 */
	public hasClass( ...className: Array<string> ): boolean {
		for ( const name of className ) {
			if ( !this._classes || !this._classes.has( name ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Returns iterator that contains all class names.
	 */
	public getClassNames(): Array<string> {
		return this._classes ? this._classes.keys() : [];
	}

	/**
	 * Returns style value for the given property mae.
	 * If the style does not exist `undefined` is returned.
	 *
	 * **Note**: This method can work with normalized style names if
	 * {@link module:engine/controller/datacontroller~DataController#addStyleProcessorRules a particular style processor rule is enabled}.
	 * See {@link module:engine/view/stylesmap~StylesMap#getAsString `StylesMap#getAsString()`} for details.
	 *
	 * For an element with style set to `'margin:1px'`:
	 *
	 * ```ts
	 * // Enable 'margin' shorthand processing:
	 * editor.data.addStyleProcessorRules( addMarginRules );
	 *
	 * const element = view.change( writer => {
	 * 	const element = writer.createElement();
	 * 	writer.setStyle( 'margin', '1px' );
	 * 	writer.setStyle( 'margin-bottom', '3em' );
	 *
	 * 	return element;
	 * } );
	 *
	 * element.getStyle( 'margin' ); // -> 'margin: 1px 1px 3em;'
	 * ```
	 */
	public getStyle( property: string ): string | undefined {
		return this._styles && this._styles.getAsString( property );
	}

	/**
	 * Returns a normalized style object or single style value.
	 *
	 * For an element with style set to: margin:1px 2px 3em;
	 *
	 * ```ts
	 * element.getNormalizedStyle( 'margin' ) );
	 * ```
	 *
	 * will return:
	 *
	 * ```ts
	 * {
	 * 	top: '1px',
	 * 	right: '2px',
	 * 	bottom: '3em',
	 * 	left: '2px'    // a normalized value from margin shorthand
	 * }
	 * ```
	 *
	 * and reading for single style value:
	 *
	 * ```ts
	 * styles.getNormalizedStyle( 'margin-left' );
	 * ```
	 *
	 * Will return a `2px` string.
	 *
	 * **Note**: This method will return normalized values only if
	 * {@link module:engine/controller/datacontroller~DataController#addStyleProcessorRules a particular style processor rule is enabled}.
	 * See {@link module:engine/view/stylesmap~StylesMap#getNormalized `StylesMap#getNormalized()`} for details.
	 *
	 * @param property Name of CSS property
	 */
	public getNormalizedStyle( property: string ): StyleValue | undefined {
		return this._styles && this._styles.getNormalized( property );
	}

	/**
	 * Returns an array that contains all style names.
	 *
	 * @param expand Expand shorthand style properties and return all equivalent style representations.
	 */
	public getStyleNames( expand?: boolean ): Array<string> {
		return this._styles ? this._styles.getStyleNames( expand ) : [];
	}

	/**
	 * Returns true if style keys are present.
	 * If more then one style property is provided - returns true only when all properties are present.
	 *
	 * ```ts
	 * element.hasStyle( 'color' ); // Returns true if 'border-top' style is present.
	 * element.hasStyle( 'color', 'border-top' ); // Returns true if 'color' and 'border-top' styles are both present.
	 * ```
	 */
	public hasStyle( ...property: Array<string> ): boolean {
		for ( const name of property ) {
			if ( !this._styles || !this._styles.has( name ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Returns ancestor element that match specified pattern.
	 * Provided patterns should be compatible with {@link module:engine/view/matcher~Matcher Matcher} as it is used internally.
	 *
	 * @see module:engine/view/matcher~Matcher
	 * @param patterns Patterns used to match correct ancestor. See {@link module:engine/view/matcher~Matcher}.
	 * @returns Found element or `null` if no matching ancestor was found.
	 */
	public findAncestor( ...patterns: Array<MatcherPattern | ( ( element: Element ) => boolean )> ): Element | null {
		const matcher = new Matcher( ...patterns as any );
		let parent = this.parent;

		while ( parent && !parent.is( 'documentFragment' ) ) {
			if ( matcher.match( parent ) ) {
				return parent;
			}

			parent = parent.parent;
		}

		return null;
	}

	/**
	 * Returns the custom property value for the given key.
	 */
	public getCustomProperty( key: string | symbol ): unknown {
		return this._customProperties.get( key );
	}

	/**
	 * Returns an iterator which iterates over this element's custom properties.
	 * Iterator provides `[ key, value ]` pairs for each stored property.
	 */
	public* getCustomProperties(): IterableIterator<[ string | symbol, unknown ]> {
		yield* this._customProperties.entries();
	}

	/**
	 * Returns identity string based on element's name, styles, classes and other attributes.
	 * Two elements that {@link #isSimilar are similar} will have same identity string.
	 * It has the following format:
	 *
	 * ```ts
	 * 'name class="class1,class2" style="style1:value1;style2:value2" attr1="val1" attr2="val2"'
	 * ```
 	 *
	 * For example:
	 *
	 * ```ts
	 * const element = writer.createContainerElement( 'foo', {
	 * 	banana: '10',
	 * 	apple: '20',
	 * 	style: 'color: red; border-color: white;',
	 * 	class: 'baz'
	 * } );
	 *
	 * // returns 'foo class="baz" style="border-color:white;color:red" apple="20" banana="10"'
	 * element.getIdentity();
	 * ```
	 *
	 * **Note**: Classes, styles and other attributes are sorted alphabetically.
	 */
	public getIdentity(): string {
		const classes = this._classes ? this._classes.keys().sort().join( ',' ) : '';
		const styles = this._styles && String( this._styles );
		const attributes = Array.from( this._attrs )
			.filter( ( [ key ] ) => key != 'style' && key != 'class' )
			.map( i => `${ i[ 0 ] }="${ i[ 1 ] }"` )
			.sort().join( ' ' );

		return this.name +
			( classes == '' ? '' : ` class="${ classes }"` ) +
			( !styles ? '' : ` style="${ styles }"` ) +
			( attributes == '' ? '' : ` ${ attributes }` );
	}

	/**
	 * Decides whether an unsafe attribute is whitelisted and should be rendered in the editing pipeline even though filtering mechanisms
	 * like {@link module:engine/view/domconverter~DomConverter#shouldRenderAttribute} say it should not.
	 *
	 * Unsafe attribute names can be specified when creating an element via {@link module:engine/view/downcastwriter~DowncastWriter}.
	 *
	 * @param attributeName The name of the attribute to be checked.
	 */
	public shouldRenderUnsafeAttribute( attributeName: string ): boolean {
		return this._unsafeAttributesToRender.includes( attributeName );
	}

	/**
	 * Clones provided element.
	 *
	 * @internal
	 * @param deep If set to `true` clones element and all its children recursively. When set to `false`,
	 * element will be cloned without any children.
	 * @returns Clone of this element.
	 */
	public _clone( deep = false ): this {
		const childrenClone: Array<Node> = [];

		if ( deep ) {
			for ( const child of this.getChildren() ) {
				childrenClone.push( child._clone( deep ) );
			}
		}

		// ContainerElement and AttributeElement should be also cloned properly.
		const cloned = new ( this.constructor as any )( this.document, this.name, this._attrs, childrenClone );

		// Clone custom properties.
		cloned._customProperties = new Map( this._customProperties );

		// Clone filler offset method.
		// We can't define this method in a prototype because it's behavior which
		// is changed by e.g. toWidget() function from ckeditor5-widget. Perhaps this should be one of custom props.
		cloned.getFillerOffset = this.getFillerOffset;

		// Clone unsafe attributes list.
		cloned._unsafeAttributesToRender = this._unsafeAttributesToRender;

		return cloned;
	}

	/**
	 * {@link module:engine/view/element~Element#_insertChild Insert} a child node or a list of child nodes at the end of this node
	 * and sets the parent of these nodes to this element.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#insert
	 * @internal
	 * @param items Items to be inserted.
	 * @fires change
	 * @returns Number of appended nodes.
	 */
	public _appendChild( items: Item | string | Iterable<Item | string> ): number {
		return this._insertChild( this.childCount, items );
	}

	/**
	 * Inserts a child node or a list of child nodes on the given index and sets the parent of these nodes to
	 * this element.
	 *
	 * @internal
	 * @see module:engine/view/downcastwriter~DowncastWriter#insert
	 * @param index Position where nodes should be inserted.
	 * @param items Items to be inserted.
	 * @fires change
	 * @returns Number of inserted nodes.
	 */
	public _insertChild( index: number, items: Item | string | Iterable<Item | string> ): number {
		this._fireChange( 'children', this );
		let count = 0;

		const nodes = normalize( this.document, items );

		for ( const node of nodes ) {
			// If node that is being added to this element is already inside another element, first remove it from the old parent.
			if ( node.parent !== null ) {
				node._remove();
			}

			( node as any ).parent = this;
			( node as any ).document = this.document;

			this._children.splice( index, 0, node );
			index++;
			count++;
		}

		return count;
	}

	/**
	 * Removes number of child nodes starting at the given index and set the parent of these nodes to `null`.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#remove
	 * @internal
	 * @param index Number of the first node to remove.
	 * @param howMany Number of nodes to remove.
	 * @fires change
	 * @returns The array of removed nodes.
	 */
	public _removeChildren( index: number, howMany: number = 1 ): Array<Node> {
		this._fireChange( 'children', this );

		for ( let i = index; i < index + howMany; i++ ) {
			( this._children[ i ] as any ).parent = null;
		}

		return this._children.splice( index, howMany );
	}

	/**
	 * Adds or overwrite attribute with a specified key and value.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#setAttribute
	 * @internal
	 * @param key Attribute key.
	 * @param value Attribute value.
	 * @param reset TODO
	 * @fires change
	 */
	public _setAttribute( key: string, value: unknown | Styles | [ string, StyleValue ], reset = true ): void {
		this._fireChange( 'attributes', this );

		if ( usesStylesMap( this.name, key ) || usesTokenList( this.name, key ) ) {
			let currentValue = this._attrs.get( key ) as ElementAttributeValue | undefined;

			if ( !currentValue ) {
				currentValue = usesStylesMap( this.name, key ) ?
					new StylesMap( this.document.stylesProcessor ) :
					new TokenList();

				this._attrs.set( key, currentValue );
			}

			if ( reset ) {
				// TODO make sure that this is not an array
				currentValue.setTo( String( value ) );
			} else if ( usesStylesMap( this.name, key ) ) {
				if ( Array.isArray( value ) ) {
					currentValue.set( value[ 0 ], value[ 1 ] );
				} else {
					currentValue.set( value as Styles ); // TODO this could be a string?
				}
			} else {
				currentValue.set( typeof value == 'string' ? value.split( /\s+/ ) : value as ArrayOrItem<string> );
			}
		}
		else {
			this._attrs.set( key, String( value ) );
		}
	}

	/**
	 * Removes attribute from the element.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#removeAttribute
	 * @internal
	 * @param key Attribute key.
	 * @returns Returns true if an attribute existed and has been removed.
	 * @fires change
	 */
	public _removeAttribute( key: string, tokens?: ArrayOrItem<string> ): boolean {
		this._fireChange( 'attributes', this );

		if ( tokens !== undefined && ( usesStylesMap( this.name, key ) || usesTokenList( this.name, key ) ) ) {
			const currentValue = this._attrs.get( key ) as ElementAttributeValue | undefined;

			if ( !currentValue ) {
				return false;
			}

			if ( usesTokenList( this.name, key ) && typeof tokens == 'string' ) {
				tokens = tokens.split( /\s+/ );
			}

			currentValue.remove( tokens );

			if ( currentValue.isEmpty ) {
				return this._attrs.delete( key );
			}

			return false;
		}

		return this._attrs.delete( key );
	}

	/**
	 * Adds specified class.
	 *
	 * ```ts
	 * element._addClass( 'foo' ); // Adds 'foo' class.
	 * element._addClass( [ 'foo', 'bar' ] ); // Adds 'foo' and 'bar' classes.
	 * ```
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#addClass
	 * @internal
	 * @fires change
	 */
	public _addClass( className: ArrayOrItem<string> ): void {
		this._setAttribute( 'class', className, false );
	}

	/**
	 * Removes specified class.
	 *
	 * ```ts
	 * element._removeClass( 'foo' );  // Removes 'foo' class.
	 * element._removeClass( [ 'foo', 'bar' ] ); // Removes both 'foo' and 'bar' classes.
	 * ```
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#removeClass
	 * @internal
	 * @fires change
	 */
	public _removeClass( className: ArrayOrItem<string> ): void {
		this._removeAttribute( 'class', className );
	}

	/**
	 * Adds style to the element.
	 *
	 * ```ts
	 * element._setStyle( 'color', 'red' );
	 * ```
	 *
	 * **Note**: This method can work with normalized style names if
	 * {@link module:engine/controller/datacontroller~DataController#addStyleProcessorRules a particular style processor rule is enabled}.
	 * See {@link module:engine/view/stylesmap~StylesMap#set `StylesMap#set()`} for details.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#setStyle
	 * @label KEY_VALUE
	 * @internal
	 * @param property Property name.
	 * @param value Value to set.
	 * @fires change
	 */
	public _setStyle( property: string, value: string ): void;

	/**
	 * Adds style to the element.
	 *
	 * ```ts
	 * element._setStyle( {
	 * 	color: 'red',
	 * 	position: 'fixed'
	 * } );
	 * ```
	 *
	 * **Note**: This method can work with normalized style names if
	 * {@link module:engine/controller/datacontroller~DataController#addStyleProcessorRules a particular style processor rule is enabled}.
	 * See {@link module:engine/view/stylesmap~StylesMap#set `StylesMap#set()`} for details.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#setStyle
	 * @label OBJECT
	 * @internal
	 * @param properties Object with key - value pairs.
	 * @fires change
	 */
	public _setStyle( properties: Record<string, string> ): void;

	public _setStyle( property: string | Record<string, string>, value?: string ): void {
		if ( typeof property != 'string' ) {
			this._setAttribute( 'style', property, false );
		} else {
			this._setAttribute( 'style', [ property, value! ], false );
		}
	}

	/**
	 * Removes specified style.
	 *
	 * ```ts
	 * element._removeStyle( 'color' );  // Removes 'color' style.
	 * element._removeStyle( [ 'color', 'border-top' ] ); // Removes both 'color' and 'border-top' styles.
	 * ```
	 *
	 * **Note**: This method can work with normalized style names if
	 * {@link module:engine/controller/datacontroller~DataController#addStyleProcessorRules a particular style processor rule is enabled}.
	 * See {@link module:engine/view/stylesmap~StylesMap#remove `StylesMap#remove()`} for details.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#removeStyle
	 * @internal
	 * @fires change
	 */
	public _removeStyle( property: ArrayOrItem<string> ): void {
		this._removeAttribute( 'style', property );
	}

	/**
	 * TODO
	 * Wraps one AttributeElement into another by
	 * merging them if possible. When merging is possible - all attributes, styles and classes are moved from wrapper
	 * element to element being wrapped.
	 *
	 * @internal
	 * @returns Returns `true` if elements are merged.
	 */
	public _mergeAttributesFrom( otherElement: Element ): boolean {
		if ( !this._canMergeAttributesFrom( otherElement ) ) {
			return false;
		}

		this._fireChange( 'attributes', this );

		// Move all attributes/classes/styles from wrapper to wrapped AttributeElement.
		for ( const [ key, otherValue ] of otherElement._attrs ) {
			const value = this._attrs.get( key );

			if ( value === undefined || typeof value == 'string' || typeof otherValue == 'string' ) {
				this._setAttribute( key, otherValue );
			}
			else {
				value.mergeFrom( otherValue );
			}
		}

		return true;
	}

	/**
	 * TODO
	 * Unwraps AttributeElement from another by removing
	 * corresponding attributes, classes and styles. All attributes, classes and styles from wrapper should be present
	 * inside element being unwrapped.
	 *
	 * @internal
	 * @returns Returns `true` if elements are unwrapped.
	 */
	public _subtractAttributesOf( otherElement: Element ): boolean {
		if ( !this._hasAttributesMatching( otherElement ) ) {
			return false;
		}

		this._fireChange( 'attributes', this );

		for ( const [ key, otherValue ] of otherElement._attrs ) {
			const value = this._attrs.get( key )!;

			if ( typeof value == 'string' || typeof otherValue == 'string' ) {
				this._attrs.delete( key );
			}
			else {
				value.remove( otherValue.keys() );

				if ( value.isEmpty ) {
					this._attrs.delete( key );
				}
			}
		}

		return true;
	}

	/**
	 * Sets a custom property. Unlike attributes, custom properties are not rendered to the DOM,
	 * so they can be used to add special data to elements.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#setCustomProperty
	 * @internal
	 */
	public _setCustomProperty( key: string | symbol, value: unknown ): void {
		this._customProperties.set( key, value );
	}

	/**
	 * Removes the custom property stored under the given key.
	 *
	 * @see module:engine/view/downcastwriter~DowncastWriter#removeCustomProperty
	 * @internal
	 * @returns Returns true if property was removed.
	 */
	public _removeCustomProperty( key: string | symbol ): boolean {
		return this._customProperties.delete( key );
	}

	/**
	 * Parses attributes provided to the element constructor before they are applied to an element. If attributes are passed
	 * as an object (instead of `Iterable`), the object is transformed to the map. Attributes with `null` value are removed.
	 * Attributes with non-`String` value are converted to `String`.
	 *
	 * @param attrs Attributes to parse.
	 * @returns Parsed attributes.
	 */
	private _parseAttributes( attrs?: ElementAttributes ) {
		const attrsMap = toMap( attrs );

		for ( const [ key, value ] of attrsMap ) {
			if ( value === null ) {
				attrsMap.delete( key );
			}
			else if ( usesStylesMap( this.name, key ) ) {
				attrsMap.set(
					key,
					value instanceof StylesMap ? value._clone() :
						new StylesMap( this.document.stylesProcessor ).setTo( String( value ) )
				);
			}
			else if ( usesTokenList( this.name, key ) ) {
				attrsMap.set(
					key,
					value instanceof TokenList ?
						value._clone() :
						new TokenList().setTo( String( value ) )
				);
			}
			else if ( typeof value != 'string' ) {
				attrsMap.set( key, String( value ) );
			}
		}

		return attrsMap as Map<string, string | ElementAttributeValue>;
	}

	/**
	 * Returns block {@link module:engine/view/filler filler} offset or `null` if block filler is not needed.
	 */
	public getFillerOffset?(): number | null;

	// @if CK_DEBUG_ENGINE // public printTree( level = 0 ): string {
	// @if CK_DEBUG_ENGINE // 	let string = '';

	// @if CK_DEBUG_ENGINE // 	string += '\t'.repeat( level ) + `<${ this.name }${ convertMapToTags( this.getAttributes() ) }>`;

	// @if CK_DEBUG_ENGINE // 	for ( const child of this.getChildren() as any ) {
	// @if CK_DEBUG_ENGINE // 		if ( child.is( '$text' ) ) {
	// @if CK_DEBUG_ENGINE // 			string += '\n' + '\t'.repeat( level + 1 ) + child.data;
	// @if CK_DEBUG_ENGINE // 		} else {
	// @if CK_DEBUG_ENGINE // 			string += '\n' + child.printTree( level + 1 );
	// @if CK_DEBUG_ENGINE // 		}
	// @if CK_DEBUG_ENGINE // 	}

	// @if CK_DEBUG_ENGINE // 	if ( this.childCount ) {
	// @if CK_DEBUG_ENGINE // 		string += '\n' + '\t'.repeat( level );
	// @if CK_DEBUG_ENGINE // 	}

	// @if CK_DEBUG_ENGINE // 	string += `</${ this.name }>`;

	// @if CK_DEBUG_ENGINE // 	return string;
	// @if CK_DEBUG_ENGINE // }

	// @if CK_DEBUG_ENGINE // public logTree(): void {
	// @if CK_DEBUG_ENGINE // 	console.log( this.printTree() );
	// @if CK_DEBUG_ENGINE // }
}

// The magic of type inference using `is` method is centralized in `TypeCheckable` class.
// Proper overload would interfere with that.
Element.prototype.is = function( type: string, name?: string ): boolean {
	if ( !name ) {
		return type === 'element' || type === 'view:element' ||
			// From super.is(). This is highly utilised method and cannot call super. See ckeditor/ckeditor5#6529.
			type === 'node' || type === 'view:node';
	} else {
		return name === this.name && ( type === 'element' || type === 'view:element' );
	}
};

/**
 * TODO
 */
export interface ElementAttributeValue {
	get isEmpty(): boolean;

	get size(): number;

	setTo( value: string ): this;

	has( name: string ): boolean;

	keys(): Array<string>;

	set( name: string, value: StyleValue ): void;
	set( stylesOrTokens: Styles | ArrayOrItem<string> ): void;

	remove( tokens: ArrayOrItem<string> ): void;

	toString(): string;

	clear(): void;

	isSimilar( other: this ): boolean;

	canMergeFrom( other: this ): boolean;

	isMatching( other: this ): boolean;

	mergeFrom( other: this ): void;

	_getConsumables( name?: string ): Array<string>;

	_getTokensMatch(
		attributeKey: string,
		patternToken: true | string | RegExp,
		patternValue?: true | string | RegExp
	): Array<[ string, string ]> | undefined;

	_clone(): this;
}

/**
 * Collection of attributes.
 */
export type ElementAttributes = Record<string, unknown> | Iterable<[ string, unknown ]> | null;

/**
 * Converts strings to Text and non-iterables to arrays.
 */
function normalize( document: Document, nodes: string | Item | Iterable<string | Item> ): Array<Node> {
	// Separate condition because string is iterable.
	if ( typeof nodes == 'string' ) {
		return [ new Text( document, nodes ) ];
	}

	if ( !isIterable( nodes ) ) {
		nodes = [ nodes ];
	}

	const normalizedNodes: Array<Node> = [];

	for ( const node of nodes ) {
		if ( typeof node == 'string' ) {
			normalizedNodes.push( new Text( document, node ) );
		} else if ( node instanceof TextProxy ) {
			normalizedNodes.push( new Text( document, node.data ) );
		} else {
			normalizedNodes.push( node );
		}
	}

	return normalizedNodes;
}

/**
 * TODO
 */
function usesTokenList( elementName: string, key: string ): boolean {
	return key == 'class' || elementName == 'a' && key == 'rel';
}

function usesStylesMap( elementName: string, key: string ): boolean {
	return key == 'style';
}
