#ifndef NODE_PRINTER_SRC_MACROS_H
#define NODE_PRINTER_SRC_MACROS_H

#include <napi.h>

#define MY_NODE_MODULE_CALLBACK(name) Napi::Value name(const Napi::CallbackInfo &info)
#define MY_NODE_MODULE_SET_METHOD(env, exports, name, method) exports.Set(name, Napi::Function::New(env, method));
#define MY_NODE_MODULE_ENV(args) Napi::Env env = args.Env()

#define RETURN_EXCEPTION(msg)                                    \
    Napi::TypeError::New(env, msg).ThrowAsJavaScriptException(); \
    return env.Null()

#define RETURN_EXCEPTION_STR(msg) RETURN_EXCEPTION(msg)

#define REQUIRE_ARGUMENTS(args, n)                         \
    if (args.Length() < (n))                               \
    {                                                      \
        RETURN_EXCEPTION_STR("Expected " #n " arguments"); \
    }

#define REQUIRE_ARGUMENT_EXTERNAL(i, var)                \
    if (args.Length() <= (i) || !args[i]->IsExternal())  \
    {                                                    \
        RETURN_EXCEPTION_STR("Argument " #i " invalid"); \
    }                                                    \
    Napi::External<void> var = args[i].As<Napi::External<void>>();

#define REQUIRE_ARGUMENT_OBJECT(args, i, var)                     \
    if (args.Length() <= (i) || !args[i].IsObject())              \
    {                                                             \
        RETURN_EXCEPTION_STR("Argument " #i " is not an object"); \
    }                                                             \
    Napi::Object var = args[i].As<Napi::Object>();

#define REQUIRE_ARGUMENT_FUNCTION(i, var)                           \
    if (args.Length() <= (i) || !args[i].IsFunction())              \
    {                                                               \
        RETURN_EXCEPTION_STR("Argument " #i " must be a function"); \
    }                                                               \
    Napi::Function<void> var = args[i].As<Napi::Function<void>>();

#define ARG_CHECK_STRING(args, i)                                 \
    if (args.Length() <= (i) || !args[i].IsString())              \
    {                                                             \
        RETURN_EXCEPTION_STR("Argument " #i " must be a string"); \
    }

#define REQUIRE_ARGUMENT_STRING(args, i, var) \
    ARG_CHECK_STRING(args, i);                \
    std::string var = info[i].As<Napi::String>().Utf8Value();

#define REQUIRE_ARGUMENT_STRINGW(args, i, var) \
    ARG_CHECK_STRING(args, i);                 \
    std::u16string var = info[i].As<Napi::String>().Utf16Value();

#define OPTIONAL_ARGUMENT_FUNCTION(i, var)                              \
    v8::Local<v8::Function> var;                                        \
    if (args.Length() > i && !args[i]->IsUndefined())                   \
    {                                                                   \
        if (!args[i]->IsFunction())                                     \
        {                                                               \
            RETURN_EXCEPTION_STR("Argument " #i " must be a function"); \
        }                                                               \
        var = v8::Local<v8::Function>::Cast(args[i]);                   \
    }

#define REQUIRE_ARGUMENT_INTEGER(args, i, var)                      \
    int var;                                                        \
    if (args[i].IsNumber())                                         \
    {                                                               \
        var = info[i].As<Napi::Number>().Int32Value();              \
    }                                                               \
    else                                                            \
    {                                                               \
        RETURN_EXCEPTION_STR("Argument " #i " must be an integer"); \
    }

#define OPTIONAL_ARGUMENT_INTEGER(args, i, var, default)                \
    int var;                                                            \
    if (args.Length() <= (i))                                           \
    {                                                                   \
        var = (default);                                                \
    }                                                                   \
    else if (args[i]->IsInt32())                                        \
    {                                                                   \
        var = args[i]->Int32Value(Nan::GetCurrentContext()).FromJust(); \
    }                                                                   \
    else                                                                \
    {                                                                   \
        RETURN_EXCEPTION_STR("Argument " #i " must be an integer");     \
    }

#endif // NODE_PRINTER_SRC_MACROS_H