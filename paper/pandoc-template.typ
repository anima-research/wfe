// Still Alive — pandoc typst template
// Inlined conf function (no external imports needed)

#let horizontalrule = line(start: (25%,0%), end: (75%,0%))

#show terms.item: it => block(breakable: false)[
  #text(weight: "bold")[#it.term]
  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]
]

#show figure.where(kind: table): set figure.caption(position: top)
#show figure.where(kind: image): set figure.caption(position: bottom)

$if(highlighting-definitions)$
$highlighting-definitions$

$endif$

#let conf(
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  abstract: none,
  abstract-title: "Abstract",
  thanks: none,
  keywords: (),
  lang: "en",
  region: "US",
  margin: (x: 1.2in, y: 1.2in),
  paper: "us-letter",
  font: (),
  fontsize: 11pt,
  mathfont: (),
  codefont: (),
  linestretch: 1.15,
  sectionnumbering: none,
  pagenumbering: "1",
  linkcolor: none,
  citecolor: none,
  filecolor: none,
  cols: 1,
  doc,
) = {
  // -- Page setup --
  set page(
    paper: paper,
    margin: margin,
    numbering: pagenumbering,
    header: context {
      if counter(page).get().first() > 2 {
        set text(8pt, fill: luma(140))
        emph[Still Alive]
        h(1fr)
        text[#counter(page).display()]
      }
    },
    footer: none,
  )

  set par(justify: true, leading: 0.65em * linestretch, first-line-indent: 0pt)
  set text(
    font: if font.len() > 0 { font } else { ("Georgia", "Libertinus Serif", "Times New Roman") },
    size: fontsize,
    lang: lang,
    region: region,
  )
  set heading(numbering: sectionnumbering)

  // -- Link styling --
  show link: set text(fill: rgb("#2a4a7a"))

  // -- Heading styles --
  show heading.where(level: 1): it => {
    set text(17pt, weight: "bold", fill: rgb("#1a1a2a"))
    v(1.5em)
    block(it)
    v(0.4em)
    line(length: 100%, stroke: 0.4pt + luma(200))
    v(0.3em)
  }

  show heading.where(level: 2): it => {
    set text(12pt, weight: "bold", fill: rgb("#2a2a3a"))
    v(1em)
    block(it)
    v(0.3em)
  }

  show heading.where(level: 3): it => {
    set text(11pt, weight: "bold", fill: rgb("#3a3a4a"))
    v(0.6em)
    block(it)
    v(0.2em)
  }

  // -- Table styling --
  set table(
    inset: (x: 7pt, y: 4pt),
    stroke: (x: none, y: 0.4pt + luma(200)),
  )
  show table: set text(9pt)

  // -- Block quote styling (callouts) --
  show quote: it => {
    block(
      width: 100%,
      inset: (left: 14pt, right: 12pt, top: 10pt, bottom: 10pt),
      stroke: (left: 2.5pt + rgb("#667")),
      fill: rgb("#f6f6f9"),
      radius: (right: 3pt),
      it.body,
    )
  }

  // -- Code styling --
  show raw.where(block: false): box.with(
    fill: luma(235),
    inset: (x: 3pt, y: 0pt),
    outset: (y: 3pt),
    radius: 2pt,
  )

  // -- Figure caption styling --
  show figure.caption: set text(9pt, style: "italic", fill: luma(80))

  // ========================================
  // Title page
  // ========================================
  {
    set page(numbering: none, header: none)

    v(2in)

    align(center)[
      #text(30pt, weight: "bold", fill: rgb("#1a1a2a"), tracking: 0.5pt)[#title]

      #if subtitle != none {
        v(0.4em)
        text(13pt, fill: luma(100))[#subtitle]
      }

      #v(2em)
      #line(length: 25%, stroke: 0.5pt + luma(180))
      #v(2em)

      // Authors
      #for author in authors {
        text(12pt, weight: "semibold")[#author.name]
        if author.affiliation != "" {
          linebreak()
          text(9.5pt, fill: luma(110))[#author.affiliation]
        }
        v(0.5em)
      }

      #v(1.5em)
      #if date != none {
        text(11pt, fill: luma(130))[#date]
      }
    ]

    pagebreak()
  }

  // ========================================
  // Body
  // ========================================
  if cols == 1 {
    doc
  } else {
    columns(cols, doc)
  }
}

#show: doc => conf(
$if(title)$
  title: [$title$],
$endif$
$if(subtitle)$
  subtitle: [$subtitle$],
$endif$
$if(author)$
  authors: (
$for(author)$
$if(author.name)$
    ( name: [$author.name$],
      affiliation: [$author.affiliation$],
      email: "" ),
$else$
    ( name: [$author$],
      affiliation: "",
      email: "" ),
$endif$
$endfor$
    ),
$endif$
$if(date)$
  date: [$date$],
$endif$
$if(lang)$
  lang: "$lang$",
$endif$
$if(section-numbering)$
  sectionnumbering: "$section-numbering$",
$endif$
  pagenumbering: $if(page-numbering)$"$page-numbering$"$else$"1"$endif$,
$if(fontsize)$
  fontsize: $fontsize$,
$endif$
$if(mainfont)$
  font: ("$mainfont$",),
$endif$
  cols: $if(columns)$$columns$$else$1$endif$,
  doc,
)

$for(include-before)$
$include-before$

$endfor$
$if(toc)$
#outline(
  title: [Contents],
  depth: $toc-depth$,
  indent: 1.5em,
)
#pagebreak()
$endif$

$body$

$for(include-after)$

$include-after$
$endfor$
