import { Reflector, PropertyMirror, InterfaceMirror, ClassMirror, TypeMirror, TypeAliasMirror, InterfaceLike, InterfaceLiteralMirror, UnionMirror, CallableMirror, CallableSignature, Parameter, ExternalTypeReference, EnumMirror, EnumMember, ModuleMirror, NamespaceMirror, NamespaceMember, ArrayMirror, StringLiteralMirror, ObjectLiteralMirror, InterfaceLikeMember, TypeParameter } from "../Reflector";

import { KindString, propertyKindStrings, typeDefKinds } from "./common";
import { InputJSON } from "./InputJSON";

// TODO: Replace all the `any`s with `unknown`s

/**
 * Constructs a concrete Reflector impl based on the output from `TypeDoc --json` 
 * 
 * @param jsonObj 
 */
export function typedocReflector(jsonObj: any): Reflector {
    const reflector = new TypedocJSONReflector();
    reflector.readJSON(jsonObj);
    return reflector;
}

class UnImplementedTypeMirror implements TypeMirror {
    // TODO: Remove this, it's just to help flesh things out and develop the tests
    isComplex: boolean = false;
    isBuiltin: boolean = false;
    isPrimitive: boolean = false;
    typeArguments: Array<TypeMirror> = [];
    name: string;

    constructor(message: string) {
        this.name = `UnImplementedTypeMirror for ${message}`;
    }
}

interface NameAndId {
    name: string;
    id: number;
}

class TypedocJSONReflector implements Reflector {

    protected _builtins: Array<TypeMirror>;
    protected _modules: Array<NameAndId> = [];

    /** Interesting types' definitions */
    protected _typeDefById: Map<number, InputJSON.BaseDecl> = new Map();

    builtinAny: TypeMirror;
    builtinUndefined: TypeMirror;
    builtinVoid: TypeMirror;
    builtinString: TypeMirror;
    builtinNumber: TypeMirror;
    builtinBoolean: TypeMirror;
    builtinNull: TypeMirror;

    constructor() {
        this.builtinAny = new Primitive('any');
        this.builtinUndefined = new Primitive('undefined');
        this.builtinVoid = new Primitive('void');
        this.builtinString = new Primitive('string');
        this.builtinNumber = new Primitive('number');
        this.builtinBoolean = new Primitive('boolean');
        this.builtinNull = new Primitive('null');

        this._builtins = [
            this.builtinAny,
            this.builtinUndefined,
            this.builtinVoid,
            this.builtinString,
            this.builtinNumber,
            this.builtinBoolean,
            this.builtinNull,
            new Primitive('false'),
            new Primitive('true'),
            new Primitive('this'),
        ];
    }

    readJSON(obj: any) {
        this.explore(obj);
    }

    protected explore(obj: any) {

        // Index any interesting typedefs
        if (obj.id && obj.name && obj.kindString && typeDefKinds.indexOf(obj.kindString) >= 0) {
            this._typeDefById.set(obj.id, obj);
        }

        if (obj.kindString === KindString.ExternalModule) {
            // External Module names are wrapped in quotes for some reason
            const name = obj.name.replace(/^"(.*?)"$/, '$1');
            const id: number = obj.id;

            this._modules.push({ name, id });
        }
       
        // Recurse

        if (obj.children && Array.isArray(obj.children)) {
            for (const child of obj.children) {
                this.explore(child);
            }
        }
    }

    findClassesByName(className: string): Array<ClassMirror> {
        let results: Array<ClassMirror> = [];

        for (const [key, value] of this._typeDefById) {
            if (value.kindString === KindString.Class && value.name === className) {
                results.push(this.describeTypeForDecl(value) as ClassMirror);
            }
        }

        return results;
    }

    describeChild(child: InputJSON.NamespaceChildDecl): NamespaceMember {

        if (InputJSON.isPropertyDecl(child)) {
            return new TypedocPropertyMirror(this, child);
        }

        if (InputJSON.isNamespaceDecl(child)) {
            return new TypedocNamespaceMirror(this, child);
        }

        if (InputJSON.isObjectLiteralDecl(child)) {
            return new TypedocObjectLiteralMirror(this, child);
        }

        if (InputJSON.isConstructorLiteralDecl(child)) {
            return new TypedocCallableMirror(this, child);
        }

        if (InputJSON.isMethodDecl(child)) {
            return new TypedocCallableMirror(this, child);
        }

        if (InputJSON.isBaseDecl(child)) {
            let maybe: unknown;

            try {
                maybe = this.describeTypeForDecl(child);
            } catch (e) { } // Ignore so we get describeChild-specific error later

            if (this.isCallable(maybe)) { return maybe; }
            if (this.isClass(maybe)) { return maybe; }
            if (this.isEnum(maybe)) { return maybe; }
            if (this.isInterface(maybe)) { return maybe; }
            if (this.isProperty(maybe)) { return maybe; }
            if (this.isTypeAlias(maybe)) { return maybe; }
        }

        if (child.kindString) {
            throw new Error(`describeChild(): do not understand child of kind "${child.kindString}"`);
        }

        throw new Error(`describeChild(): do not understand child:\n${JSON.stringify(child, null, 4)}`);
    }

    describeTypeForDecl(decl: InputJSON.BaseDecl): TypeMirror {

        if (InputJSON.isFunctionDecl(decl)) {
            return new TypedocCallableMirror(this, decl);
        }

        if (InputJSON.isClassDecl(decl)) {
            return new TypedocClassMirror(this, decl);
        }

        if (InputJSON.isInterfaceDecl(decl)) {
            return new TypedocInterfaceMirror(this, decl);
        }

        if (InputJSON.isTypeAliasDecl(decl)) {
            return new TypedocAliasMirror(this, decl);
        }

        if (InputJSON.isEnumDecl(decl)) {
            return new TypedocEnumMirror(this, decl);
        }

        if (InputJSON.isInterfaceLiteralDecl(decl)) {
            return new TypedocInterfaceLiteralMirror(this, decl);
        }

        if (InputJSON.isSignaturesLiteralDecl(decl)) {
            return new TypedocCallableMirror(this, decl);
        }

        throw new Error(`describeTypeForDecl(): do not understand decl:\n${JSON.stringify(decl, null, 4)}`);
    }

    describeTypeForTypeDetails(typeDetails: InputJSON.TypeDetails): TypeMirror {

        if (InputJSON.isTypeOperatorDecl(typeDetails)) {
            return new TypedocTypeOperator(typeDetails);
        }

        if (InputJSON.isUnknownTypeReference(typeDetails)) {
            // Known unknowns
            return new TypedocUnknownTypeMirror(typeDetails.name);
        }

        if (InputJSON.isTypeParamDecl(typeDetails)) {
            return new TypedocTypeParameter(typeDetails);
        }

        if (InputJSON.isInternalTypeReference(typeDetails)) {
            const id = typeDetails.id;
            const td = this._typeDefById.get(id);

            if (td) {
                return this.describeTypeForDecl(td);
            }

            // Unknown unknowns - We get here sometimes, so we'll try our best

            let name;

            if ((typeDetails as any).name) {
                name = (typeDetails as any).name;
            } 
            else {
                name = `(unknown #${id})`;
            }

            return new TypedocUnknownTypeMirror(name);
        }

        if (InputJSON.isExternalTypeReference(typeDetails)) {

            // Special case for Array which sometimes appears as an external reference, sometimes not. NFI why.
            if (typeDetails.name === 'Array') {
                let typeArgument = this.builtinAny;
                if (Array.isArray(typeDetails.typeArguments) && typeDetails.typeArguments.length === 1) {
                    typeArgument = this.describeTypeForTypeDetails(typeDetails.typeArguments[0]);
                }
                return new TypedocArrayMirror(typeArgument);
            }

            return new TypedocExternalTypeReference(this, typeDetails);
        }

        if (InputJSON.isArrayDecl(typeDetails)) {
            const typeArgument = this.describeTypeForTypeDetails(typeDetails.elementType);
            return new TypedocArrayMirror(typeArgument);
        }

        if (InputJSON.isIntrinsicRef(typeDetails)) {
            return this.describeBuiltin(typeDetails.name);
        }

        if (InputJSON.isUnionDecl(typeDetails)) {
            const types: Array<TypeMirror> = typeDetails.types.map(branchDetails => this.describeTypeForTypeDetails(branchDetails));
            return new TypedocUnionMirror(this, types);
        }

        if (InputJSON.isStringLiteral(typeDetails)) {
            return new TypedocStringLiteral(typeDetails.value);
        }

        if (InputJSON.isReflectionDecl(typeDetails)) {
            return this.describeTypeForDecl(typeDetails.declaration);
        }

        throw new Error(`describeTypeForTypeDetails(): do not understand typeDetails:\n${JSON.stringify(typeDetails, null, 4)}`);
    }

    get moduleNames(): Array<string> {
        return this._modules.map(nameAndId => nameAndId.name);
    }

    get modules(): Array<ModuleMirror> {
        return this.moduleNames.map(name => this.describeModule(name));
    }

    isArray(mirror: any): mirror is ArrayMirror {
        return mirror instanceof TypedocArrayMirror;
    }

    isInterface(mirror: any): mirror is InterfaceMirror {
        return mirror instanceof TypedocInterfaceMirror;
    }

    isClass(mirror: any): mirror is ClassMirror {
        return mirror instanceof TypedocClassMirror;
    }

    isTypeAlias(mirror: any): mirror is TypeAliasMirror {
        return mirror instanceof TypedocAliasMirror;
    }

    isInterfaceLiteral(mirror: any): mirror is InterfaceLiteralMirror {
        return mirror instanceof TypedocInterfaceLiteralMirror;
    }

    isInterfaceLike(mirror: any): mirror is InterfaceLike {
        return mirror instanceof TypedocInterfaceMirror ||
            mirror instanceof TypedocClassMirror ||
            mirror instanceof TypedocInterfaceLiteralMirror;
    }

    isUnion(mirror: any): mirror is UnionMirror {
        return mirror instanceof TypedocUnionMirror;
    }

    isCallable(mirror: any): mirror is CallableMirror {
        return mirror instanceof TypedocCallableMirror;
    }

    isEnum(mirror: any): mirror is EnumMirror {
        return mirror instanceof TypedocEnumMirror;
    }

    isExternalTypeReference(mirror: any): mirror is ExternalTypeReference {
        return mirror instanceof TypedocExternalTypeReference;
    }

    isModule(mirror: any): mirror is ModuleMirror {
        return mirror instanceof TypedocModuleMirror;
    }

    isNamespace(mirror: any): mirror is NamespaceMirror {
        return mirror instanceof TypedocNamespaceMirror;
    }

    isProperty(mirror: any): mirror is PropertyMirror {
        return mirror instanceof TypedocPropertyMirror;
    }

    isObjectLiteral(mirror: any): mirror is ObjectLiteralMirror {
        return mirror instanceof TypedocObjectLiteralMirror;
    }

    decodeTypeArguments(typeArguments?: Array<InputJSON.TypeDetails>): Array<TypeMirror> {

        if (!typeArguments || typeArguments.length === 0) {
            return [];
        }

        return typeArguments.map(details => this.describeTypeForTypeDetails(details));
    }

    describeModule(moduleName: string): ModuleMirror {
        const foundEntry = this._modules.find(entry => entry.name === moduleName);
        if (!foundEntry) {
            throw new Error(`describeModule - could not find module named ${moduleName}`);
        }

        const definition = this._typeDefById.get(foundEntry.id);

        if (!InputJSON.isModuleDecl(definition)) {
            throw new Error(`describeModule - got bad definition:\n${JSON.stringify(definition, null, 4)}`);
        }

        return new TypedocModuleMirror(this, definition);
    }

    describeBuiltin(name: string): TypeMirror {
        for (const mirror of this._builtins) {
            if (mirror.name === name) {
                return mirror;
            }
        }

        throw new Error(`describeBuiltin() - do not know about builtin named "${name}"`);
    }
}

/**
 * A base class to implement a lot of common functionality.
 * 
 * Should be a mixin rather than a base class but there's no nice way to do that RN.
 */
abstract class TypeMirrorBase<D> {
    // TODO:   ^^^^^^^^^^^^^^ rename this

    // Basic stuff common by all

    protected definition: D;
    protected reflector: TypedocJSONReflector;

    id: number;
    kindString?: string;
    name?: string;

    // CanHazComments - not used by all impls

    hasComment: boolean;
    commentShortText: string;
    commentLongText: string;

    // Constructor

    constructor(reflector: TypedocJSONReflector, definition: D) {
        // Set up common stuff
        this.reflector = reflector;
        this.definition = definition;

        if (InputJSON.isBaseDecl(definition)) {
            this.id = definition.id;
            this.kindString = definition.kindString;
            this.name = definition.name;
        }
        else {
            this.id = -1;
        }

        // Set up doc comments if available
        if (InputJSON.isCanHazComment(definition)) {
            const comment = (definition as InputJSON.CanHazComment).comment;
            // TODO: shouldn't need     ^^^^^^^^^^^^^^^^^^^^^^^^^^

            this.hasComment = !!comment;
            this.commentShortText = comment && comment.shortText || '';
            this.commentLongText = comment && comment.text || '';
        } else {
            this.hasComment = false;
            this.commentShortText = '';
            this.commentLongText = '';
        }
    }
}

/**
 * Base for class and interface impls
 */
abstract class TypedocInterfaceMirrorBase extends TypeMirrorBase<InputJSON.InterfaceDecl> implements InterfaceLike {

    readonly isComplex = true;
    readonly isPrimitive = false;
    readonly typeArguments: Array<TypeMirror>;
    abstract readonly isBuiltin: boolean;

    propertyNames: Array<string> = [];

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.InterfaceDecl) {
        super(reflector, definition);

        if (definition.children) {
            this.propertyNames = definition.children
                .filter(child => InputJSON.isPropertyDecl(child))
                .map(child => child.name);
        }

        this.typeArguments = reflector.decodeTypeArguments(definition.typeArguments);
    }

    describeProperty(propName: string): PropertyMirror {
        let propDesc;

        if (this.definition.children) {
            for (const child of this.definition.children) {
                if (InputJSON.isPropertyDecl(child) && child.name === propName) {
                    propDesc = child;
                    break;
                }
            }
        }

        if (!propDesc) {
            throw new Error(`describeProperty: could not find a property name '${propName}'`);
        }

        return new TypedocPropertyMirror(this.reflector, propDesc);
    }

    protected _members?: Array<InterfaceLikeMember>;

    get members(): Array<InterfaceLikeMember> {
        if (!this._members) {
            this._members = [];
            const { reflector } = this;
            if (this.definition.children) {
                const all = this.definition.children.map(decl => reflector.describeChild(decl));
                for (const member of all) {
                    if (reflector.isNamespace(member)
                        || reflector.isClass(member)
                        || reflector.isObjectLiteral(member)
                        || reflector.isTypeAlias(member)
                        || reflector.isInterface(member)
                        || reflector.isEnum(member)) {
                        throw new Error(`Not expecting member of kind "${member.constructor.name}" in InterfaceLike`);
                    }

                    this._members.push(member);
                }
            }
        }

        return this._members;
    }

    get properties(): Array<PropertyMirror> {
        return this.members.filter(member => this.reflector.isProperty(member)) as Array<PropertyMirror>;
    }

    get methods(): Array<CallableMirror> {
        const callables = this.members.filter(member => this.reflector.isCallable(member)) as Array<CallableMirror>;
        return callables.filter(callable => callable.isMethod);
    }
    
    get constructorMirror(): CallableMirror | undefined {
        const callables = this.members.filter(member => this.reflector.isCallable(member)) as Array<CallableMirror>;
        return callables.find(callable => callable.isConstructor);
    }
}

class TypedocInterfaceMirror extends TypedocInterfaceMirrorBase implements InterfaceMirror {
    readonly isAbstract = true;
    readonly isBuiltin = false;
}

class TypedocInterfaceLiteralMirror extends TypedocInterfaceMirrorBase implements InterfaceLiteralMirror {
    readonly isBuiltin = false;
}

class TypedocClassMirror extends TypedocInterfaceMirrorBase implements ClassMirror {
    get isBuiltin() {
        // TODO: Separate this for builtins that are also classes, like Date?
        return false;
    }

    get isAbstract(): boolean {
        throw new Error('Implement isAbstract on TypedocJSONClassMirror');
    }
}

class TypedocObjectLiteralMirror implements ObjectLiteralMirror {

    readonly isComplex: boolean = true;
    readonly isPrimitive: boolean = false;
    readonly name: string
    readonly typeArguments: Array<TypeMirror> = [];
    readonly isAbstract = true;
    readonly isBuiltin = false;

    protected reflector: TypedocJSONReflector;
    protected definition: InputJSON.ObjectLiteralDecl;

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.ObjectLiteralDecl) {
        this.reflector = reflector;
        this.definition = definition;
        this.name = definition.name;
    }

    get properties(): Array<PropertyMirror> {
        const result: Array<PropertyMirror> = [];

        // TODO: Switch this to use a common getChildren base
        if (this.definition.children) {
            for (const decl of this.definition.children) {
                const child = this.reflector.describeChild(decl);
                if (!this.reflector.isProperty(child)) {
                    throw new Error(`Object literal - expecting only property children but got ${child.constructor.name}`);
                }
                result.push(child);
            }
        }

        return result;
    }
}

class TypedocPropertyMirror extends TypeMirrorBase<InputJSON.PropertyDecl> implements PropertyMirror {

    readonly readable: boolean;
    readonly writeable: boolean;
    readonly name!: string; // All properties have a name, but is set by super constructor

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.PropertyDecl) {

        if (propertyKindStrings.indexOf(definition.kindString) === -1) {
            throw new Error(`TypedocJSONPropertyMirror does not know about kind "${definition.kindString}"`);
        }

        super(reflector, definition);

        if (definition.kindString === KindString.Property || definition.kindString === KindString.Variable) {
            this.readable = true;
            this.writeable = !(definition.flags && definition.flags.isConst);
        } else {
            throw new Error(`TODO: calculate readable and writeable for kind ${definition.kindString}`);
        }
    }

    get type(): TypeMirror {
        return this.reflector.describeTypeForTypeDetails(this.definition.type);
    }

    get defaultValue(): string | undefined {
        if (typeof this.definition.defaultValue === 'string') {
            return this.definition.defaultValue.trim();
        }
        return undefined;
    }
}

/**
 * Type Mirror IMPL for primitive builtins, for which we don't have defs
 */
class Primitive implements TypeMirror {

    isComplex: boolean = false;
    isBuiltin: boolean = true;
    isPrimitive: boolean = true;
    readonly typeArguments: Array<TypeMirror> = [];

    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

/** String literal (as type) mirror */
class TypedocStringLiteral implements StringLiteralMirror {

    isBuiltin: boolean = true;
    isComplex: boolean = false;
    isPrimitive: boolean = true;
    readonly typeArguments: Array<TypeMirror> = [];
    value: string;
    name = 'string';

    constructor(value: string) {
        this.value = value;
    }
}

/**
 * Mirror for arrays. 
 * 
 * Does not use the definition, because TS can use either ("reference" + "typeArguments", or "array" + "elementType") defs :(
 */
class TypedocArrayMirror implements TypeMirror {
    isComplex: boolean = false;
    isBuiltin: boolean = true;
    isPrimitive: boolean = false;
    name = 'Array';

    typeArguments: Array<TypeMirror>;

    constructor(typeArgument: TypeMirror) {
        this.typeArguments = [typeArgument];
    }
}

class TypedocAliasMirror extends TypeMirrorBase<InputJSON.TypeAliasDecl> implements TypeAliasMirror {

    readonly isBuiltin = false;
    readonly isPrimitive = false;
    readonly isComplex = false;
    readonly typeArguments: Array<TypeMirror> = [];

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.TypeAliasDecl) {
        super(reflector, definition);
    }

    get targetDefinition(): TypeMirror {
        return this.reflector.describeTypeForTypeDetails(this.definition.type);
    }
}

class TypedocUnionMirror implements UnionMirror {
    isComplex: boolean = true;
    isBuiltin: boolean = true;
    isPrimitive: boolean = false;
    members: Array<TypeMirror>;
    readonly typeArguments: Array<TypeMirror> = [];

    protected reflector: TypedocJSONReflector;

    constructor(reflector: TypedocJSONReflector, types: Array<TypeMirror>) {
        this.reflector = reflector;
        this.members = types;
    }
}

class TypedocCallableMirror extends TypeMirrorBase<InputJSON.SignaturesLiteralDecl> implements CallableMirror {
    readonly isComplex: boolean = false;
    readonly isBuiltin: boolean = false;
    readonly isPrimitive: boolean = false;
    readonly typeArguments: Array<TypeMirror>;
    readonly signatures: Array<CallableSignature>;
    
    readonly isMethod: boolean;
    readonly isConstructor: boolean;

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.SignaturesLiteralDecl) {
        super(reflector, definition);
        this.signatures = definition.signatures.map(sig => new TypedocCallableSignature(reflector, sig));
        if (typeof definition.name === 'string') {
            this.name = definition.name;
        }
        this.typeArguments = reflector.decodeTypeArguments(definition.typeArguments);
        this.isMethod = definition.kindString === KindString.Method;
        this.isConstructor = definition.kindString === KindString.Constructor;
    }
}

class TypedocCallableSignature extends TypeMirrorBase<InputJSON.Signature> implements CallableSignature {
    readonly parameters: Array<Parameter>;
    readonly returnType: TypeMirror;

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.Signature) {
        super(reflector, definition);

        this.returnType = reflector.describeTypeForTypeDetails(definition.type);

        const parameters: Array<Parameter> = [];

        if (definition.parameters) {
            for (const inputParam of definition.parameters) {
                parameters.push({
                    name: inputParam.name,
                    type: reflector.describeTypeForTypeDetails(inputParam.type)
                });
            }
        }

        this.parameters = parameters;
    }
}

class TypedocExternalTypeReference implements ExternalTypeReference {
    readonly name: string;
    readonly isComplex: boolean = false; // We can't really know for sure, unfortunately
    readonly isBuiltin: boolean = false;
    readonly isPrimitive: boolean = false;
    readonly typeArguments: Array<TypeMirror>;

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.ExternalTypeReference) {
        this.name = definition.name;
        this.typeArguments = reflector.decodeTypeArguments(definition.typeArguments);
    }
}

class TypedocEnumMirror extends TypeMirrorBase<InputJSON.EnumDecl> implements EnumMirror {

    readonly members: Array<EnumMember>;

    readonly isComplex: boolean = true;
    readonly isBuiltin: boolean = false;
    readonly isPrimitive: boolean = false;
    readonly typeArguments: Array<TypeMirror> = [];

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.EnumDecl) {
        super(reflector, definition);

        this.members = definition.children.map(memberDecl => this.createChild(memberDecl));
    }

    protected createChild(memberDecl: InputJSON.EnumMemberDecl): EnumMember {
        const { name, defaultValue } = memberDecl;
        return { name, defaultValue };
    }
}

abstract class TypedocNamespaceBase<D extends InputJSON.ModuleDecl | InputJSON.NamespaceDecl> extends TypeMirrorBase<D> {

    protected _members?: Array<NamespaceMember>
    name!: string; // All namespaces have names

    constructor(reflector: TypedocJSONReflector, definition: D) {
        super(reflector, definition);
    }

    get members(): Array<NamespaceMember> {

        if (!this._members) {
            if (this.definition.children) {
                this._members = this.definition.children.map(decl => this.reflector.describeChild(decl));
            }
            else {
                this._members = [];
            }
        }

        return this._members;
    }

    get namespaces(): Array<NamespaceMirror> {
        const reflector = this.reflector;
        return this.members.filter(member => reflector.isNamespace(member)) as Array<NamespaceMirror>;
    }

    get properties(): Array<PropertyMirror> {
        return this.members.filter(member => this.reflector.isProperty(member)) as Array<PropertyMirror>;
    }

    get interfaces(): Array<InterfaceMirror> {
        return this.members.filter(member => this.reflector.isInterface(member)) as Array<InterfaceMirror>;
    }

    get classes(): Array<ClassMirror> {
        return this.members.filter(member => this.reflector.isClass(member)) as Array<ClassMirror>;
    }

    get enums(): Array<EnumMirror> {
        return this.members.filter(member => this.reflector.isEnum(member)) as Array<EnumMirror>;
    }

    get typeAliases(): Array<TypeAliasMirror> {
        return this.members.filter(member => this.reflector.isTypeAlias(member)) as Array<TypeAliasMirror>;
    }

    get functions(): Array<CallableMirror> {
        return this.members.filter(member => this.reflector.isCallable(member)) as Array<CallableMirror>;
    }

    get objectLiterals(): Array<ObjectLiteralMirror> {
        return this.members.filter(member => this.reflector.isObjectLiteral(member)) as Array<ObjectLiteralMirror>;
    }
}

class TypedocNamespaceMirror extends TypedocNamespaceBase<InputJSON.NamespaceDecl> implements NamespaceMirror { }

class TypedocModuleMirror extends TypedocNamespaceBase<InputJSON.ModuleDecl> implements ModuleMirror {
    readonly originalName: string;

    constructor(reflector: TypedocJSONReflector, definition: InputJSON.ModuleDecl) {
        super(reflector, definition);
        this.name = definition.name.replace(/^"(.*?)"$/, '$1');
        this.originalName = definition.originalName;
    }
}

/**
 * Represents anything that just doesn't make any flaming sense at all
 */
class TypedocUnknownTypeMirror implements TypeMirror {
    isComplex: boolean = false;    
    isBuiltin: boolean = false;
    isPrimitive: boolean = false;
    name: string 
    typeArguments: Array<TypeMirror> = [];

    constructor(name:string) {
        this.name = name;
    }
}

class TypedocTypeParameter implements TypeParameter {
    isComplex: boolean = false;    
    isBuiltin: boolean = false;
    isPrimitive: boolean = false;
    name: string 
    typeArguments: Array<TypeMirror> = [];

    constructor(definition: InputJSON.TypeParamDecl) {
        this.name = definition.name;
    }
}

class TypedocTypeOperator implements TypeMirror {
    isComplex: boolean = false;
    isBuiltin: boolean = true;
    isPrimitive: boolean = false;
    name: string;
    typeArguments: Array<TypeMirror> = [];

    constructor(definition: InputJSON.TypeOperatorDecl) {
        this.name = `${definition.operator} ${definition.target.name}`;
    }
}
