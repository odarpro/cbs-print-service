{
  'targets': [
    {
      'target_name': 'node_printer',
      'sources': [
        # is like "ls -1 src/*.cc", but gyp does not support direct patterns on
        # sources
        'src/node_printer.cc',
        'src/node_printer_posix.cc',
        'src/node_printer_win.cc'
      ],
      'include_dirs' : [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
      'cflags_cc+': [
        "-Wno-deprecated-declarations"
      ],
      'conditions': [
        # common exclusions
        ['OS!="linux"', {'sources/': [['exclude', '_linux\\.cc$']]}],
        ['OS!="mac"', {'sources/': [['exclude', '_mac\\.cc|mm?$']]}],
        ['OS!="win"', {
          'sources/': [['exclude', '_win\\.cc$']]}, {
          # else if OS==win, exclude also posix files
          'sources/': [['exclude', '_posix\\.cc$']]
        }],
        # specific settings
        ['OS!="win"', {
          'cflags':[
            '<!(cups-config --cflags)'
          ],
          'ldflags':[
            '<!(cups-config --libs)'
            #'-lcups -lgssapi_krb5 -lkrb5 -lk5crypto -lcom_err -lz -lpthread -lm -lcrypt -lz'
          ],
          'libraries':[
            '<!(cups-config --libs)'
            #'-lcups -lgssapi_krb5 -lkrb5 -lk5crypto -lcom_err -lz -lpthread -lm -lcrypt -lz'
          ],
          'link_settings': {
            'libraries': [
              '<!(cups-config --libs)'
            ]
          }
        }],
        ['OS=="mac"', {
          'cflags':[
            "-stdlib=libc++"
          ],
          'xcode_settings': {
            "OTHER_CPLUSPLUSFLAGS":["-std=c++17", "-stdlib=libc++"],
            "OTHER_LDFLAGS": ["-stdlib=libc++"],
            "MACOSX_DEPLOYMENT_TARGET": "10.7",
          },
        }],
      ]
    }
  ]
}
